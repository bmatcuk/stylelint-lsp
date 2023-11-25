import {
  CodeAction,
  CodeActionKind,
  Command,
  Diagnostic,
  ExecuteCommandParams,
  ExecuteCommandRequest,
  Connection,
  Position,
  Range,
  TextDocuments,
  TextEdit,
  VersionedTextDocumentIdentifier,
  RequestHandler,
  CodeActionParams,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import { CommandIds, CommandTitles, DisableRuleCommandIds } from "./constants"
import BufferedMessageQueue from "buffered-message-queue"
import { autoFix, validateDocument } from "./validate"
import Settings from "./settings"

/** Disable-rule commands when operating on a single line */
export const DISABLE_RULES_FOR_LINE: DisableRuleCommandIds[] = [
  DisableRuleCommandIds.applyDisableRuleInline,
  DisableRuleCommandIds.applyDisableRuleToLine,
  DisableRuleCommandIds.applyDisableRuleToFile,
]

/** Disable-rule commands when operating on a range */
export const DISABLE_RULES_FOR_RANGE: DisableRuleCommandIds[] = [
  DisableRuleCommandIds.applyDisableRuleToRange,
  DisableRuleCommandIds.applyDisableRuleToFile,
]

export const DISABLE_RULES_FOR_WHOLE_FILE: DisableRuleCommandIds[] = [
  DisableRuleCommandIds.applyDisableRuleToFile,
]

/**
 * Given a line of code, returns the indentation.
 * @param line The line of code
 * @returns the indentation
 */
export function getIndent(line: string): string {
  return (line.match(/^\s*/) as [string])[0]
}

/** A function that returns TextEdit(s) to disable a stylelint rule */
type RuleDisabler = (
  document: TextDocument,
  range: Range,
  rule: string
) => TextEdit[]

/** Functions to create TextEdit(s) to disable a stylelint rule */
export const DISABLE_RULE_TEXT_EDITS: Record<
  DisableRuleCommandIds,
  RuleDisabler
> = {
  /**
   * TextEdits to create an inline rule disable comment.
   * @param document The TextDocument
   * @param range The range of code to create TextEdits for... note that this
   *              function assumes this range is just a single line
   * @param rule The rule to disable
   */
  [DisableRuleCommandIds.applyDisableRuleInline]: (
    document: TextDocument,
    range: Range,
    rule: string
  ) => {
    const lineNr = range.start.line
    const line = document.getText(
      Range.create(Position.create(lineNr, 0), Position.create(lineNr + 1, 0))
    )
    const character =
      line.length - (line.endsWith("\r\n") ? 2 : line.endsWith("\n") ? 1 : 0)
    const newText = ` /* stylelint-disable-line ${rule} */`
    return [TextEdit.insert(Position.create(lineNr, character), newText)]
  },

  /**
   * TextEdits to create disable next line rule comment.
   * @param document The TextDocument
   * @param range The range of code to create TextEdits for... note that this
   *              function assumes this range is just a single line
   * @param rule The rule to disable
   */
  [DisableRuleCommandIds.applyDisableRuleToLine]: (
    document: TextDocument,
    range: Range,
    rule: string
  ) => {
    const lineNr = range.start.line
    const line = document.getText(
      Range.create(Position.create(lineNr, 0), Position.create(lineNr + 1, 0))
    )
    const indent = getIndent(line)
    const newText = `${indent}/* stylelint-disable-next-line ${rule} */\n`
    return [TextEdit.insert(Position.create(lineNr, 0), newText)]
  },

  /**
   * TextEdits to create a file-wide rule disable comment.
   * @param _document Unused.
   * @param _range Unused.
   * @param rule The rule to disable
   */
  [DisableRuleCommandIds.applyDisableRuleToFile]: (
    _document: TextDocument,
    _range: Range,
    rule: string
  ) => {
    const newText = `/* stylelint-disable ${rule} */\n`
    return [TextEdit.insert(Position.create(0, 0), newText)]
  },

  /**
   * TextEdits to disable a rule for a block of code (ie, a disable comment
   * followed by an enable comment).
   * @param document The TextDocument
   * @param range The range of code to create TextEdits for
   * @param rule The rule to disable
   */
  [DisableRuleCommandIds.applyDisableRuleToRange]: (
    document: TextDocument,
    range: Range,
    rule: string
  ) => {
    const startLineNr = range.start.line
    const startLine = document.getText(
      Range.create(
        Position.create(startLineNr, 0),
        Position.create(startLineNr + 1, 0)
      )
    )
    const startIndent = getIndent(startLine)
    const startNewText = `${startIndent}/* stylelint-disable ${rule} */\n`

    const endLineNr = range.end.line
    let endLine = document.getText(
      Range.create(
        Position.create(endLineNr, 0),
        Position.create(endLineNr + 1, 0)
      )
    )
    if (endLine === "" || endLine === "\r\n" || endLine === "\n") {
      // If the line at the end of the range is blank, try to get the
      // indentation for the previous line
      endLine = document.getText(
        Range.create(
          Position.create(endLineNr - 1, 0),
          Position.create(endLineNr, 0)
        )
      )
    }
    const endIndent = getIndent(endLine)
    const endNewText = `${endIndent}/* stylelint-enable ${rule} */\n`

    return [
      TextEdit.insert(Position.create(startLineNr, 0), startNewText),
      TextEdit.insert(Position.create(endLineNr + 1, 0), endNewText),
    ]
  },
}

/** Command arguments for applyAutoFixes */
interface ApplyAutoFixesCommandParams extends ExecuteCommandParams {
  command: CommandIds
  arguments: [VersionedTextDocumentIdentifier]
}

function isApplyAutoFixesCommand(
  params: ExecuteCommandParams
): params is ApplyAutoFixesCommandParams {
  return Boolean(params.command === CommandIds.applyAutoFixes)
}

/** Command arguments for a disable-rule command */
interface DisableRuleCommandParams extends ExecuteCommandParams {
  command: DisableRuleCommandIds
  arguments: [VersionedTextDocumentIdentifier, Range, string]
}

/**
 * Determines if ExecuteCommandParams is a disable-rule command
 * @param params The ExecuteCommandParams
 * @returns true if it is a DisbaleRuleCommandParams
 */
function isDisableRuleCommand(
  params: ExecuteCommandParams
): params is DisableRuleCommandParams {
  return Boolean(
    DISABLE_RULE_TEXT_EDITS[params.command as DisableRuleCommandIds]
  )
}

export function shouldApplyToLine(range: Range): boolean {
  return (
    range.start.line === range.end.line ||
    (range.end.character === 0 && range.start.line + 1 === range.end.line)
  )
}

export function shouldApplyToWholeFile(
  range: Range,
  lineCount: number
): boolean {
  return (
    range.start.line === 0 &&
    (range.end.line === lineCount - 1 || range.end.line === lineCount)
  )
}

export function buildCodeActionHandler(
  documents: TextDocuments<TextDocument>,
  settings: Settings
): RequestHandler<CodeActionParams, (Command | CodeAction)[], void> {
  return (params) => {
    // if the document doesn't exist anymore, quit
    const document = documents.get(params.textDocument.uri)
    if (!document) {
      return []
    }

    // Determine if this is a command request for a
    // single line, the whole file, or a range
    const results: (Command | CodeAction)[] = []
    const { range } = params
    const applyToLine = shouldApplyToLine(range)
    const applyToWholeFile = shouldApplyToWholeFile(range, document.lineCount)

    let returnSource = true
    let returnQuickFixes = true
    if (params.context.only) {
      returnSource = params.context.only.includes(CodeActionKind.Source)
      returnQuickFixes = params.context.only.includes(CodeActionKind.QuickFix)
    }

    // auto-fix
    if (returnSource && applyToWholeFile) {
      const supportsCodeActionLiterals =
        settings.supportedCodeActionLiterals.includes(CodeActionKind.Source)
      const title = CommandTitles[CommandIds.applyAutoFixes]
      const command = Command.create(
        title,
        CommandIds.applyAutoFixes,
        VersionedTextDocumentIdentifier.create(document.uri, document.version)
      )

      if (supportsCodeActionLiterals) {
        results.push({
          title,
          kind: CodeActionKind.Source,
          command,
        })
      } else {
        results.push(command)
      }
    }

    // Disable-rule commands
    if (returnQuickFixes) {
      // Get a map of rules to the Diagnostics they apply to
      const rules = new Map<string, Diagnostic[]>()
      params.context.diagnostics.forEach((diagnostic) => {
        if (typeof diagnostic.code === "string" && diagnostic.code !== "") {
          const diagnostics = rules.get(diagnostic.code)
          if (diagnostics) {
            diagnostics.push(diagnostic)
          } else {
            rules.set(diagnostic.code, [diagnostic])
          }
        }
      })

      // which commands to return
      const disableRuleCommands = applyToLine
        ? DISABLE_RULES_FOR_LINE
        : applyToWholeFile
          ? DISABLE_RULES_FOR_WHOLE_FILE
          : DISABLE_RULES_FOR_RANGE
      const supportsCodeActionLiterals =
        settings.supportedCodeActionLiterals.includes(CodeActionKind.QuickFix)

      // for each rule and command, create the Commands/CodeActions
      rules.forEach((diagnostics, rule) => {
        disableRuleCommands.forEach((disableKey) => {
          const title = `${CommandTitles[disableKey]}: ${rule}`
          if (supportsCodeActionLiterals) {
            results.push({
              title,
              kind: CodeActionKind.QuickFix,
              diagnostics,
              edit: {
                changes: {
                  [params.textDocument.uri]: DISABLE_RULE_TEXT_EDITS[
                    disableKey
                  ](document, range, rule),
                },
              },
            })
          } else {
            results.push(
              Command.create(
                title,
                disableKey,
                VersionedTextDocumentIdentifier.create(
                  document.uri,
                  document.version
                ),
                range,
                rule
              )
            )
          }
        })
      })
    }

    return results
  }
}

export function buildExecuteCommandHandler(
  connection: Connection,
  messageQueue: BufferedMessageQueue,
  documents: TextDocuments<TextDocument>,
  settings: Settings
): RequestHandler<ExecuteCommandParams, unknown, void> {
  return async (params: ExecuteCommandParams) => {
    let document: TextDocument | undefined
    let label = ""
    let edits: TextEdit[] = []

    if (isApplyAutoFixesCommand(params)) {
      const {
        arguments: [documentIdentifier],
      } = params
      document = documents.get(documentIdentifier.uri)
      if (!document) {
        return
      }

      label = CommandTitles[CommandIds.applyAutoFixes]

      const config = await settings.resolve(document)
      edits = await autoFix(document, config)
    } else if (isDisableRuleCommand(params)) {
      // retrieve the params and document
      const {
        command,
        arguments: [documentIdentifier, range, rule],
      } = params
      document = documents.get(documentIdentifier.uri)
      if (!document) {
        return
      }

      label = `${CommandTitles[command]}: ${rule}`
      edits = DISABLE_RULE_TEXT_EDITS[command](document, range, rule)
    }

    if (document && edits.length) {
      // build the ApplyWorkspaceEditParams
      const workspaceEdits = {
        label,
        edit: {
          changes: {
            [document.uri]: edits,
          },
        },
      }

      // Send the edits to the client
      const result = await connection.workspace.applyEdit(workspaceEdits)
      if (result.applied) {
        // grab the document again 'cause the version probably changed
        document = documents.get(document.uri)
        if (document) {
          validateDocument(messageQueue, document)
        }
      } else {
        let msg = `Could not apply edit "${label}"`
        if (result.failedChange) {
          msg = `${msg}: ${result.failedChange}`
        }
        connection.console.error(msg)
      }
    }
  }
}

/**
 * Register Command handlers
 * @param connection The Connection object
 * @param messageQueue A BufferedMessageQueue
 * @param documents The TextDocuments
 * @param settings The Settings object
 */
export function registerCommandHandlers(
  connection: Connection,
  messageQueue: BufferedMessageQueue,
  documents: TextDocuments<TextDocument>,
  settings: Settings
): void {
  connection.onCodeAction(buildCodeActionHandler(documents, settings))

  // Handle commands
  messageQueue.onRequest(
    ExecuteCommandRequest.type,
    buildExecuteCommandHandler(connection, messageQueue, documents, settings),
    ({ arguments: args }: ExecuteCommandParams) =>
      args && args[0] && args[0].version
  )
}
