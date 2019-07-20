import {
  ClientCapabilities,
  CodeActionKind,
  DidChangeConfigurationParams,
  IConnection,
  TextDocument,
  TextDocumentIdentifier,
} from "vscode-languageserver"
import URI from "vscode-uri"
import globalStylelint, { LinterOptions } from "stylelint"
import resolveFrom from "resolve-from"
import path from "path"

/** Default ClientSettings */
export const defaultClientSettings = {
  /** If true, auto-fix the entire document on format */
  autoFixOnFormat: false,

  /** If true, auto-fix the entire document on save */
  autoFixOnSave: false,

  /**
   * Stylelint config. If neither config nor configFile are specified,
   * stylelint will automatically look for a config file.
   */
  config: undefined as LinterOptions["config"] | undefined,

  /**
   * Path to a stylelint config. If neither config nor configFile are
   * specified, stylelint will automatically look for a config file.
   */
  configFile: undefined as LinterOptions["configFile"] | undefined,

  /** stylelint configOverrides, passed directly into lint() */
  configOverrides: undefined as LinterOptions["configOverrides"] | undefined,

  /** If false, all validation (including auto-fixing) is disabled */
  enable: true,

  /** If true, run validation on save */
  validateOnSave: true,

  /** If true, run validation while typing */
  validateOnType: true,
}

/** Settings passed from the client */
export type ClientSettings = typeof defaultClientSettings

/** Client settings plus server-side settings */
export interface ServerSettings extends ClientSettings {
  /** The stylelint instance to use */
  stylelint: typeof globalStylelint
}

/** Manages settings */
export default class Settings {
  private connection: IConnection
  private supportsConfigurationRequests: boolean
  private globalSettings: Thenable<ServerSettings>
  private documentToSettings: Map<string, Thenable<ServerSettings>>
  private pathToStylelint: Map<string, typeof globalStylelint>
  private _supportedCodeActionLiterals: CodeActionKind[]

  /**
   * @constructor
   * @param connection The IConnection object
   */
  constructor(connection: IConnection) {
    this.connection = connection
    this.supportsConfigurationRequests = false
    this.globalSettings = Promise.resolve({
      ...defaultClientSettings,
      stylelint: globalStylelint,
    })
    this.documentToSettings = new Map()
    this.pathToStylelint = new Map()
    this._supportedCodeActionLiterals = []
  }

  /**
   * Typically called in the connection's onInitialize handler
   * @param initializeParams The InitializeParams from the connection.
   */
  initialize(capabilities: ClientCapabilities): void {
    this.supportsConfigurationRequests = Boolean(
      capabilities.workspace && capabilities.workspace.configuration
    )
    this._supportedCodeActionLiterals =
      capabilities.textDocument &&
      capabilities.textDocument.codeAction &&
      capabilities.textDocument.codeAction.codeActionLiteralSupport
        ? capabilities.textDocument.codeAction.codeActionLiteralSupport
            .codeActionKind.valueSet
        : []
  }

  /**
   * Resolve settings for the given TextDocument
   * @param document The TextDocument to retrieve settings for
   * @returns ServerSettings for the document
   */
  resolve(document: TextDocumentIdentifier): Thenable<ServerSettings> {
    if (!this.supportsConfigurationRequests) {
      return this.globalSettings
    }

    const uri = document.uri
    const cached = this.documentToSettings.get(uri)
    if (cached) {
      return cached
    }

    const promise = this.connection.workspace
      .getConfiguration({ scopeUri: uri, section: "" })
      .then((settings: { stylelintplus: ClientSettings }) => {
        const stylelint = this.resolveStylelint(uri)
        return {
          ...defaultClientSettings,
          ...settings.stylelintplus,
          stylelint,
        }
      })
    this.documentToSettings.set(uri, promise)
    return promise
  }

  /**
   * From a document uri, find and load the appropriate stylelint library
   * @param uri The document uri
   * @returns an instance of stylelint
   */
  private resolveStylelint(uri: TextDocument["uri"]): typeof globalStylelint {
    let stylelint = globalStylelint
    const parsedUri = URI.parse(uri)
    if (parsedUri.scheme === "file") {
      const dirname = path.dirname(parsedUri.fsPath)
      const stylelintPath = resolveFrom.silent(dirname, "stylelint")
      if (stylelintPath) {
        const maybeStylelint = this.pathToStylelint.get(stylelintPath)
        if (maybeStylelint) {
          stylelint = maybeStylelint
        } else {
          this.connection.tracer.log(`stylelint found at ${stylelintPath}`)
          stylelint = require(stylelintPath)
          this.pathToStylelint.set(stylelintPath, stylelint)
        }
      }
    }
    return stylelint
  }

  /**
   * Handle a DidChangeConfigurationNotification. You must register to receive
   * these notifications, if the client supports them, and then register a
   * listener that will call this method.
   * @param params The DidChangeConfigurationParams from the Notification
   */
  clientConfigurationChanged(params: DidChangeConfigurationParams): void {
    if (this.supportsConfigurationRequests) {
      this.documentToSettings.clear()
    } else if (params.settings.stylelintplus) {
      this.globalSettings = Promise.resolve({
        ...defaultClientSettings,
        ...params.settings.stylelintplus,
        stylelint: globalStylelint,
      })
    }
  }

  /**
   * Call this when a document is closed to clean up settings
   * @param document The TextDocument that closed
   */
  closeDocument(document: TextDocument): void {
    this.documentToSettings.delete(document.uri)
  }

  get supportedCodeActionLiterals(): CodeActionKind[] {
    return this._supportedCodeActionLiterals
  }
}
