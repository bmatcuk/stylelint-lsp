import {
  DiagnosticSeverity,
  IConnection,
  NotificationType,
  Position,
  Range,
  TextDocument,
  TextDocumentSaveReason,
  TextDocuments,
  TextEdit,
  VersionedTextDocumentIdentifier,
} from "vscode-languageserver"
import { URI } from "vscode-uri"
import fastDiff from "fast-diff"
import { LinterResult, LinterOptions } from "stylelint"
import path from "path"

import BufferedMessageQueue from "./buffered-message-queue"
import Settings, { ServerSettings } from "./settings"

const STYLELINT_CONFIG_FILES = [
  ".stylelintignore",
  "stylelint.config.js",
  ".stylelintrc",
  ".stylelintrc.json",
  ".stylelintrc.yaml",
  ".stylelintrc.yml",
  ".stylelintrc.js",
  "package.json",
]

export const validateNotification = new NotificationType<
  VersionedTextDocumentIdentifier,
  void
>("stylelint/validate")

function lint(
  uri: TextDocument["uri"],
  code: LinterOptions["code"],
  settings: ServerSettings,
  fix: boolean = false
): Promise<LinterResult> {
  const parsedUri = URI.parse(uri)
  let codeFilename: LinterOptions["codeFilename"] | undefined = undefined
  if (parsedUri.scheme === "file") {
    codeFilename = parsedUri.fsPath
  }

  // Since we don't care about the "output", we give stylelint a noop
  // formatter to save some processing time. This is especially useful when fix
  // = true because the formatter runs, but then the output is replaced by the
  // fixed CSS, completely wasting the formatter's time.
  return settings.stylelint.lint({
    code,
    codeFilename,
    config: settings.config,
    configFile: settings.configFile,
    configOverrides: settings.configOverrides,
    fix,
    formatter: () => "",
  })
}

async function validate(
  connection: IConnection,
  document: TextDocument,
  settings: ServerSettings
): Promise<void> {
  const {
    results: [result],
  } = await lint(document.uri, document.getText(), settings)
  if (result.ignored) {
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: [],
    })
    return
  }

  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: result.warnings.map(warning => {
      const position = Position.create(warning.line - 1, warning.column - 1)
      return {
        code: warning.rule,
        message: warning.text,
        range: Range.create(position, position),
        severity:
          warning.severity === "warning"
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Error,
        source: "stylelintplus",
      }
    }),
  })
}

interface Change {
  start: number
  end: number
  newText: string
}

export async function autoFix(
  document: TextDocument,
  settings: ServerSettings
): Promise<TextEdit[]> {
  const originalText = document.getText()
  const {
    output,
    results: [result],
  } = await lint(document.uri, originalText, settings, true)
  if (result.ignored) {
    return []
  }

  // diff old and new to create a list of changes
  const changes: Change[] = []
  let lastChange: Change | undefined = undefined
  let cur = 0
  fastDiff(originalText, output).forEach(([action, str]) => {
    if (action === fastDiff.EQUAL) {
      cur += str.length
    } else if (action === fastDiff.DELETE) {
      if (lastChange && lastChange.end === cur) {
        // lastChange was an insert at the same position, so we can combine
        // the insert and delete
        lastChange.end += str.length
      } else {
        lastChange = { start: cur, end: cur + str.length, newText: "" }
        changes.push(lastChange)
      }
      cur += str.length
    } else {
      // INSERT
      if (lastChange && lastChange.end === cur) {
        // lastChange was a delete at the same position, so we can combine
        // the insert and delete
        lastChange.newText += str
      } else {
        lastChange = { start: cur, end: cur, newText: str }
        changes.push(lastChange)
      }
    }
  })

  // convert changes to TextEdits
  return changes.map(({ start, end, newText }) =>
    TextEdit.replace(
      Range.create(document.positionAt(start), document.positionAt(end)),
      newText
    )
  )
}

export function validateDocument(
  messageQueue: BufferedMessageQueue,
  document: VersionedTextDocumentIdentifier
): void {
  messageQueue.addNotification(validateNotification, document, document.version)
}

export function validateAll(
  messageQueue: BufferedMessageQueue,
  documents: TextDocument[]
): void {
  documents.forEach(document => {
    validateDocument(messageQueue, document)
  })
}

export function registerValidateHandlers(
  connection: IConnection,
  messageQueue: BufferedMessageQueue,
  documents: TextDocuments,
  settings: Settings
): void {
  const needsValidation = new Set<TextDocument["uri"]>()

  messageQueue.onNotification(
    validateNotification,
    async identifier => {
      // the document may have been closed before we had a chance to process it
      const document = documents.get(identifier.uri)
      if (!document) {
        return
      }

      const config = await settings.resolve(document)
      if (config.enable) {
        await validate(connection, document, config)
      } else {
        connection.sendDiagnostics({
          uri: document.uri,
          diagnostics: [],
        })
      }
    },
    document => document.version
  )

  documents.onDidOpen(async event => {
    const config = await settings.resolve(event.document)
    if (config.enable) {
      validateDocument(messageQueue, event.document)
    }
  })

  documents.onDidChangeContent(async params => {
    const config = await settings.resolve(params.document)
    if (
      config.enable &&
      (config.validateOnType || needsValidation.has(params.document.uri))
    ) {
      needsValidation.delete(params.document.uri)
      validateDocument(messageQueue, params.document)
    }
  })

  documents.onWillSaveWaitUntil(async event => {
    if (event.reason === TextDocumentSaveReason.AfterDelay) {
      return []
    }

    const config = await settings.resolve(event.document)
    if (!config.enable || !config.autoFixOnSave) {
      return []
    }

    needsValidation.add(event.document.uri)
    return autoFix(event.document, config)
  })

  documents.onDidSave(async event => {
    const config = await settings.resolve(event.document)
    if (
      config.enable &&
      (config.validateOnSave ||
        config.autoFixOnSave ||
        needsValidation.has(event.document.uri))
    ) {
      needsValidation.delete(event.document.uri)
      validateDocument(messageQueue, event.document)
    }
  })

  documents.onDidClose(event => {
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] })
  })

  connection.onDocumentFormatting(async params => {
    const document = documents.get(params.textDocument.uri)
    if (!document) {
      return []
    }

    const config = await settings.resolve(document)
    if (!config.enable || !config.autoFixOnFormat) {
      return []
    }

    needsValidation.add(document.uri)
    return autoFix(document, config)
  })

  connection.onDidChangeWatchedFiles(async params => {
    // The client should be watching for any changes to stylelint config files.
    // If any config files change, we're just going to revalidate all of the
    // documents.
    const revalidate = params.changes.some(change => {
      const uri = URI.parse(change.uri)
      const filename = path.basename(uri.fsPath)
      return STYLELINT_CONFIG_FILES.includes(filename)
    })

    if (revalidate) {
      validateAll(messageQueue, documents.all())
    }
  })
}
