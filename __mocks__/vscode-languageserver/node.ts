const vscodeLanguageServer = jest.requireActual("vscode-languageserver")

const createConnection = jest
  .fn(() => ({
    onCodeAction: jest.fn().mockName("Connection.onCodeAction"),
    onRequest: jest.fn().mockName("Connection.onRequest"),
    onNotification: jest.fn().mockName("Connection.onNotification"),
    workspace: {
      applyEdit: jest
        .fn()
        .mockName("Connection.workspace.applyEdit")
        .mockReturnValue({ applied: true }),
      getConfiguration: jest
        .fn()
        .mockName("Connection.workspace.getConfiguration")
        .mockReturnValue(Promise.resolve({ stylelintplus: {} })),
    },
  }))
  .mockName("createConnection")

const defaultTextDocument: import("vscode-languageserver-textdocument").TextDocument =
  {
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

module.exports = new Proxy(vscodeLanguageServer, {
  get(target, prop, receiver) {
    if (prop === "createConnection") {
      return createConnection
    } else if (prop === "TextDocuments") {
      return TextDocuments
    }
    return Reflect.get(target, prop, receiver)
  },
})
