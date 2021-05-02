#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  ClientCapabilities,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
} from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"

import Settings from "./settings"
import { CommandIds, DisableRuleCommandIds } from "./constants"
import { registerCommandHandlers } from "./commands"
import BufferedMessageQueue from "./buffered-message-queue"
import { registerValidateHandlers, validateAll } from "./validate"

const connection = createConnection()
const documents = new TextDocuments<TextDocument>(TextDocument)
documents.listen(connection)

const settings = new Settings(connection)
const messageQueue = new BufferedMessageQueue(connection)
registerValidateHandlers(connection, messageQueue, documents, settings)
registerCommandHandlers(connection, messageQueue, documents, settings)

let clientCapabilities: ClientCapabilities = {}
connection.onInitialize((param) => {
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
          DisableRuleCommandIds.applyDisableRuleToRange,
        ],
      },
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
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

connection.onDidChangeConfiguration((params) => {
  settings.clientConfigurationChanged(params)
  validateAll(messageQueue, documents.all())
})

documents.onDidClose((event) => {
  settings.closeDocument(event.document)
})

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
