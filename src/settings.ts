import {
  ClientCapabilities,
  CodeActionKind,
  DidChangeConfigurationParams,
  IConnection,
  TextDocument,
  TextDocumentIdentifier,
} from "vscode-languageserver"
import { URI } from "vscode-uri"
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
  /** linting function */
  lint: typeof globalStylelint["lint"]
}

/** Manages settings */
export default class Settings {
  private connection: IConnection
  private supportsConfigurationRequests: boolean
  private globalSettings: ClientSettings
  private documentToSettings: Map<string, Thenable<ServerSettings>>
  private pathToStylelint: Map<string, typeof globalStylelint>
  private failedDocuments: Set<string>
  private _supportedCodeActionLiterals: CodeActionKind[]

  /**
   * @constructor
   * @param connection The IConnection object
   */
  constructor(connection: IConnection) {
    this.connection = connection
    this.supportsConfigurationRequests = false
    this.globalSettings = { ...defaultClientSettings }
    this.documentToSettings = new Map()
    this.pathToStylelint = new Map()
    this.failedDocuments = new Set()
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
    const uri = document.uri
    if (!this.supportsConfigurationRequests) {
      return Promise.resolve({
        ...this.globalSettings,
        lint: this.lintFunc(uri, globalStylelint),
      })
    }

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
          lint: this.lintFunc(uri, stylelint),
        }
      })
    this.documentToSettings.set(uri, promise)
    return promise
  }

  /**
   * Returns a lint function that skips linting if the specified uri has failed
   * in the past, and records if it fails in the future.
   * @param uri The document's uri
   * @param stylelint The stylelint instance to use
   * @returns a lint function
   */
  private lintFunc(
    uri: string,
    stylelint: typeof globalStylelint
  ): typeof globalStylelint["lint"] {
    return async (...args) => {
      if (!this.failedDocuments.has(uri)) {
        try {
          return await stylelint.lint(...args)
        } catch (error) {
          // log error and disable stylelint for this uri
          console.error(`Error when trying to validate ${uri}`, error)
          this.failedDocuments.add(uri)
        }
      }

      // empty results will cause validate/autoFix to do nothing
      return {
        errored: true,
        output: "",
        results: [],
      }
    }
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
      this.globalSettings = {
        ...defaultClientSettings,
        ...params.settings.stylelintplus,
      }
    }
  }

  /**
   * When stylelint configuration files change, clear failedDocuments so we can
   * retry linting them.
   */
  clearFailedDocuments(): void {
    this.failedDocuments.clear()
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
