import {
  createConnection,
  TextDocuments,
  NotificationType,
  ClientCapabilities,
  DidChangeConfigurationNotification,
} from "vscode-languageserver"

import Settings from "./settings"
import { CommandIds, DisableRuleCommandIds } from "./constants"
import { registerCommandHandlers } from "./commands"
import BufferedMessageQueue from "./buffered-message-queue"
import { registerValidateHandlers, validateAll } from "./validate"

const connection = createConnection()
const documents = new TextDocuments()
documents.listen(connection)

const settings = new Settings(connection)
const messageQueue = new BufferedMessageQueue(connection)
registerValidateHandlers(connection, messageQueue, documents, settings)
registerCommandHandlers(connection, messageQueue, documents, settings)

let clientCapabilities: ClientCapabilities = {}
connection.onInitialize(param => {
  clientCapabilities = param.capabilities
  settings.initialize(clientCapabilities)
  return {
    capabilities: {
      codeActionProvider: true,
      documentFormattingProvider: true,
      executeCommandProvider: {
        commands: [
          CommandIds.applyAutoFixes,
          DisableRuleCommandIds.applyDisableRuleInline,
          DisableRuleCommandIds.applyDisableRuleToFile,
          DisableRuleCommandIds.applyDisableRuleToLine,
        ],
      },
      textDocumentSync: {
        openClose: true,
        change: documents.syncKind,
        willSaveWaitUntil: true,
        save: {
          includeText: false,
        },
      },
    },
  }
})

connection.onInitialized(() => {
  if (
    clientCapabilities.workspace &&
    clientCapabilities.workspace.didChangeConfiguration &&
    clientCapabilities.workspace.didChangeConfiguration.dynamicRegistration
  ) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    )
  }
})

connection.onDidChangeConfiguration(params => {
  settings.clientConfigurationChanged(params)
  validateAll(messageQueue, documents.all())
})

documents.onDidClose(event => {
  settings.closeDocument(event.document)
})

const exitNotification = new NotificationType<[number, string?], void>(
  "stylelint/exit"
)

// If the process exits, notify the client
const nodeExit = process.exit
process.exit = ((code?: number): void => {
  const stack = new Error("stack")
  connection.sendNotification(exitNotification, [code ? code : 0, stack.stack])
  setTimeout(() => {
    nodeExit(code)
  }, 1000)
}) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */

// If there is an uncaught exception, notify the client
process.on("uncaughtException", (error: Error): void => {
  let message = error.message
  if (error.stack) {
    message = `${message}\n\n${error.stack}`
  }
  connection.console.error(`Uncaught exception: ${message}`)
})

// start the server
connection.console.info(`stylelint running in node ${process.version}`)
connection.listen()
