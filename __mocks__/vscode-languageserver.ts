const vscodeLanguageServer = jest.requireActual("vscode-languageserver")

const createConnection = jest
  .fn(() => ({
    onCodeAction: jest.fn().mockName("IConnection.onCodeAction"),
    onRequest: jest.fn().mockName("IConnection.onRequest"),
    onNotification: jest.fn().mockName("IConnection.onNotification"),
    workspace: {
      applyEdit: jest
        .fn()
        .mockName("IConnection.workspace.applyEdit")
        .mockReturnValue({ applied: true }),
      getConfiguration: jest
        .fn()
        .mockName("IConnection.workspace.getConfiguration")
        .mockReturnValue(Promise.resolve({ stylelintplus: {} })),
    },
  }))
  .mockName("createConnection")
vscodeLanguageServer.createConnection = createConnection

const defaultTextDocument: import("vscode-languageserver").TextDocument = {
  uri: "file://path/to/file",
  languageId: "source",
  version: 0,
  getText: jest.fn().mockName("TextDocument.getText"),
  positionAt: jest.fn().mockName("TextDocument.positionAt"),
  offsetAt: jest.fn().mockName("TextDocument.offsetAt"),
  lineCount: 10,
}

const TextDocuments = jest
  .fn(() => ({
    get: jest
      .fn()
      .mockName("TextDocuments.get")
      .mockReturnValue(defaultTextDocument),
  }))
  .mockName("TextDocuments")
vscodeLanguageServer.TextDocuments = TextDocuments

module.exports = vscodeLanguageServer
