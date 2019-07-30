import {
  CancellationToken,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Command,
  Diagnostic,
  ExecuteCommandParams,
  IConnection,
  Position,
  Range,
  RequestHandler,
  TextDocument,
  TextDocuments,
  TextEdit,
  createConnection,
} from "vscode-languageserver"

import {
  DISABLE_RULES_FOR_LINE,
  DISABLE_RULES_FOR_RANGE,
  DISABLE_RULES_FOR_WHOLE_FILE,
  DISABLE_RULE_TEXT_EDITS,
  buildCodeActionHandler,
  buildExecuteCommandHandler,
  getIndent,
  shouldApplyToLine,
  shouldApplyToWholeFile,
} from "./commands"
import { DisableRuleCommandIds, CommandIds } from "./constants"
import { getSupportedCodeActionLiteralsMock } from "./__mocks__/settings"
import Settings from "./settings"
import { autoFix, validateDocument } from "./validate"
const { default: BufferedMessageQueue } = jest.genMockFromModule(
  "./buffered-message-queue"
)
jest.mock("./settings")
jest.mock("./validate")

describe("getIdent", () => {
  const code = "var monkey = 'bagel'"
  test.each([
    ["no indentation", ""],
    ["indentation with spaces", "  "],
    ["indentation with tabs", "\t\t"],
  ])("%s", (_, indentation) => {
    const line = `${indentation}${code}`
    expect(getIndent(line)).toBe(indentation)
  })
})

describe("DISABLE_RULE_TEXT_EDITS", () => {
  const lineNr = 1
  const range = Range.create(
    Position.create(lineNr, 5),
    Position.create(lineNr, 5)
  )
  const line = "var monkey = 'bagel'\n"
  let document: TextDocument
  beforeEach(() => {
    document = {
      uri: "file://path/to/file",
      languageId: "source",
      version: 0,
      getText: jest.fn(_ => line),
      positionAt: jest.fn(),
      offsetAt: jest.fn(),
      lineCount: 10,
    }
  })

  test("inline", () => {
    const edit = DISABLE_RULE_TEXT_EDITS[
      DisableRuleCommandIds.applyDisableRuleInline
    ](document, range, "rule")

    expect(document.getText).toHaveBeenCalledTimes(1)
    expect(document.getText).toHaveBeenCalledWith(
      Range.create(Position.create(lineNr, 0), Position.create(lineNr + 1, 0))
    )

    const character = line.length - 1
    expect(edit).toEqual([
      TextEdit.insert(
        Position.create(lineNr, character),
        " /* stylelint-disable-line rule */"
      ),
    ])
  })

  test("next line", () => {
    const edit = DISABLE_RULE_TEXT_EDITS[
      DisableRuleCommandIds.applyDisableRuleToLine
    ](document, range, "rule")

    expect(document.getText).toHaveBeenCalledTimes(1)
    expect(document.getText).toHaveBeenCalledWith(
      Range.create(Position.create(lineNr, 0), Position.create(lineNr + 1, 0))
    )

    expect(edit).toEqual([
      TextEdit.insert(
        Position.create(lineNr, 0),
        "/* stylelint-disable-next-line rule */\n"
      ),
    ])
  })

  test("whole file", () => {
    const edit = DISABLE_RULE_TEXT_EDITS[
      DisableRuleCommandIds.applyDisableRuleToFile
    ](document, range, "rule")

    expect(edit).toEqual([
      TextEdit.insert(Position.create(0, 0), "/* stylelint-disable rule */\n"),
    ])
  })

  test("block", () => {
    const endLineNr = lineNr + 2
    const blockRange = Range.create(
      Position.create(lineNr, 5),
      Position.create(endLineNr, 5)
    )
    const edit = DISABLE_RULE_TEXT_EDITS[
      DisableRuleCommandIds.applyDisableRuleToRange
    ](document, blockRange, "rule")

    expect(document.getText).toHaveBeenCalledTimes(2)
    expect(document.getText).toHaveBeenNthCalledWith(
      1,
      Range.create(Position.create(lineNr, 0), Position.create(lineNr + 1, 0))
    )
    expect(document.getText).toHaveBeenNthCalledWith(
      2,
      Range.create(
        Position.create(endLineNr, 0),
        Position.create(endLineNr + 1, 0)
      )
    )

    expect(edit).toEqual([
      TextEdit.insert(
        Position.create(lineNr, 0),
        "/* stylelint-disable rule */\n"
      ),
      TextEdit.insert(
        Position.create(endLineNr + 1, 0),
        "/* stylelint-enable rule */\n"
      ),
    ])
  })
})

describe("shouldApplyToLine", () => {
  test("range includes a single character", () => {
    const position = Position.create(1, 5)
    const range = Range.create(position, position)
    expect(shouldApplyToLine(range)).toBeTruthy()
  })

  test("range includes a single line", () => {
    const range = Range.create(Position.create(1, 0), Position.create(2, 0))
    expect(shouldApplyToLine(range)).toBeTruthy()
  })

  test("range includes more than one line", () => {
    const range = Range.create(Position.create(1, 5), Position.create(3, 5))
    expect(shouldApplyToLine(range)).toBeFalsy()
  })

  test("range includes the whole file", () => {
    const range = Range.create(Position.create(0, 0), Position.create(10, 0))
    expect(shouldApplyToLine(range)).toBeFalsy()
  })
})

describe("shouldApplyToWholeFile", () => {
  test("range includes a single character", () => {
    const position = Position.create(1, 5)
    const range = Range.create(position, position)
    expect(shouldApplyToWholeFile(range, 10)).toBeFalsy()
  })

  test("range includes a single line", () => {
    const range = Range.create(Position.create(1, 0), Position.create(2, 0))
    expect(shouldApplyToWholeFile(range, 10)).toBeFalsy()
  })

  test("range includes more than one line", () => {
    const range = Range.create(Position.create(1, 5), Position.create(3, 5))
    expect(shouldApplyToWholeFile(range, 10)).toBeFalsy()
  })

  test("range includes the whole file", () => {
    const range = Range.create(Position.create(0, 0), Position.create(10, 0))
    expect(shouldApplyToWholeFile(range, 10)).toBeTruthy()
  })
})

describe("buildCodeActionHandler", () => {
  let connection: IConnection
  let documents: TextDocuments
  let settings: Settings
  let onCodeActionHandler: RequestHandler<
    CodeActionParams,
    (Command | CodeAction)[],
    void
  >
  let document: TextDocument
  let range: Range
  let diagnostics: Diagnostic[]
  let codeActionParam: CodeActionParams
  beforeEach(() => {
    connection = createConnection()
    documents = new TextDocuments()
    settings = new Settings(connection)
    onCodeActionHandler = buildCodeActionHandler(documents, settings)

    // returns the mocked document from __mocks__/vscode-languageserver.ts
    const getDocumentMock = documents.get as jest.Mock
    document = documents.get("file://path/to/file") as TextDocument
    getDocumentMock.mockClear()

    range = Range.create(Position.create(1, 5), Position.create(1, 5))
    diagnostics = [
      Diagnostic.create(
        Range.create(Position.create(1, 5), Position.create(1, 5)),
        "message",
        undefined,
        "rule"
      ),
    ]
    codeActionParam = {
      textDocument: {
        uri: document.uri,
      },
      range,
      context: {
        diagnostics,
      },
    }
  })

  test("checks that document still exists", () => {
    const getDocument = documents.get as jest.Mock
    getDocument.mockReturnValueOnce(null)

    const result = onCodeActionHandler(codeActionParam, CancellationToken.None)

    expect(getDocument).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  describe("apply to whole file", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let expectedSources: any[], expectedQuickFixes: any[], unexpected: any[]
    beforeAll(() => {
      expectedSources = [
        expect.objectContaining({ command: CommandIds.applyAutoFixes }),
      ]
      expectedQuickFixes = DISABLE_RULES_FOR_WHOLE_FILE.map(command =>
        expect.objectContaining({ command })
      )

      const allCommands: DisableRuleCommandIds[] = Object.keys(
        DISABLE_RULE_TEXT_EDITS
      ) as DisableRuleCommandIds[]
      unexpected = allCommands.filter(
        command => !DISABLE_RULES_FOR_WHOLE_FILE.includes(command)
      )
    })

    beforeEach(() => {
      range.start.line = 0
      range.end.line = document.lineCount
    })

    test("without context.only set", () => {
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const expected = expectedSources.concat(expectedQuickFixes)
      expect(result).toEqual(expect.arrayContaining(expected))
      expect(result).toEqual(expect.not.arrayContaining(unexpected))
    })

    test("with context.only sources", () => {
      codeActionParam.context.only = [CodeActionKind.Source]
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const allUnexpected = expectedQuickFixes.concat(unexpected)
      expect(result).toEqual(expect.arrayContaining(expectedSources))
      expect(result).toEqual(expect.not.arrayContaining(allUnexpected))
    })

    test("with context.only quickfixes", () => {
      codeActionParam.context.only = [CodeActionKind.QuickFix]
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const allUnexpected = expectedSources.concat(unexpected)
      expect(result).toEqual(expect.arrayContaining(expectedQuickFixes))
      expect(result).toEqual(expect.not.arrayContaining(allUnexpected))
    })
  })

  describe("apply to line", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let expectedSources: any[], expectedQuickFixes: any[], unexpected: any[]
    beforeAll(() => {
      expectedSources = []
      expectedQuickFixes = DISABLE_RULES_FOR_LINE.map(command =>
        expect.objectContaining({ command })
      )

      const allCommands: DisableRuleCommandIds[] = Object.keys(
        DISABLE_RULE_TEXT_EDITS
      ) as DisableRuleCommandIds[]
      unexpected = allCommands.filter(
        command => !DISABLE_RULES_FOR_LINE.includes(command)
      )
    })

    test("without context.only set", () => {
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const expected = expectedSources.concat(expectedQuickFixes)
      expect(result).toEqual(expect.arrayContaining(expected))
      expect(result).toEqual(expect.not.arrayContaining(unexpected))
    })

    test("with context.only sources", () => {
      codeActionParam.context.only = [CodeActionKind.Source]
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const allUnexpected = expectedQuickFixes.concat(unexpected)
      expect(result).toEqual(expect.arrayContaining(expectedSources))
      expect(result).toEqual(expect.not.arrayContaining(allUnexpected))
    })

    test("with context.only quickfixes", () => {
      codeActionParam.context.only = [CodeActionKind.QuickFix]
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const allUnexpected = expectedSources.concat(unexpected)
      expect(result).toEqual(expect.arrayContaining(expectedQuickFixes))
      expect(result).toEqual(expect.not.arrayContaining(allUnexpected))
    })
  })

  describe("apply to range", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let expectedSources: any[], expectedQuickFixes: any[], unexpected: any[]
    beforeAll(() => {
      expectedSources = []
      expectedQuickFixes = DISABLE_RULES_FOR_RANGE.map(command =>
        expect.objectContaining({ command })
      )

      const allCommands: DisableRuleCommandIds[] = Object.keys(
        DISABLE_RULE_TEXT_EDITS
      ) as DisableRuleCommandIds[]
      unexpected = allCommands.filter(
        command => !DISABLE_RULES_FOR_RANGE.includes(command)
      )
    })

    beforeEach(() => {
      range.start.line = 1
      range.end.line = document.lineCount - 1
    })

    test("without context.only set", () => {
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const expected = expectedSources.concat(expectedQuickFixes)
      expect(result).toEqual(expect.arrayContaining(expected))
      expect(result).toEqual(expect.not.arrayContaining(unexpected))
    })

    test("with context.only sources", () => {
      codeActionParam.context.only = [CodeActionKind.Source]
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const allUnexpected = expectedQuickFixes.concat(unexpected)
      expect(result).toEqual(expect.arrayContaining(expectedSources))
      expect(result).toEqual(expect.not.arrayContaining(allUnexpected))
    })

    test("with context.only quickfixes", () => {
      codeActionParam.context.only = [CodeActionKind.QuickFix]
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const allUnexpected = expectedSources.concat(unexpected)
      expect(result).toEqual(expect.arrayContaining(expectedQuickFixes))
      expect(result).toEqual(expect.not.arrayContaining(allUnexpected))
    })
  })

  describe("supports code action literals", () => {
    // eslint-disable @typescript-eslint/no-explicit-any
    let expectedSources: any[]
    let expectedQuickFixes: any[]
    let expectedSourceLiterals: any[]
    let expectedQuickFixLiterals: any[]
    // eslint-enable @typescript-eslint/no-explicit-any
    beforeAll(() => {
      expectedSources = [
        expect.objectContaining({ command: CommandIds.applyAutoFixes }),
      ]
      expectedQuickFixes = DISABLE_RULES_FOR_WHOLE_FILE.map(command =>
        expect.objectContaining({ command })
      )

      expectedSourceLiterals = [
        expect.objectContaining({
          kind: CodeActionKind.Source,
          command: expect.objectContaining({
            command: CommandIds.applyAutoFixes,
          }),
        }),
      ]
      expectedQuickFixLiterals = DISABLE_RULES_FOR_WHOLE_FILE.map(_command =>
        expect.objectContaining({
          kind: CodeActionKind.QuickFix,
          edit: {
            changes: expect.objectContaining({
              [document.uri]: expect.any(Array),
            }),
          },
        })
      )
    })

    beforeEach(() => {
      // "whole file" will include both source and quickfix actions
      range.start.line = 0
      range.end.line = document.lineCount
    })

    test("source support", () => {
      // called twice
      getSupportedCodeActionLiteralsMock(settings)
        .mockReturnValueOnce([CodeActionKind.Source])
        .mockReturnValueOnce([CodeActionKind.Source])
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const expected = expectedSourceLiterals.concat(expectedQuickFixes)
      const unexpected = expectedSources.concat(expectedQuickFixLiterals)
      expect(result).toEqual(expect.arrayContaining(expected))
      expect(result).toEqual(expect.not.arrayContaining(unexpected))
    })

    test("quickfix support", () => {
      // called twice
      getSupportedCodeActionLiteralsMock(settings)
        .mockReturnValueOnce([CodeActionKind.QuickFix])
        .mockReturnValueOnce([CodeActionKind.QuickFix])
      const result = onCodeActionHandler(
        codeActionParam,
        CancellationToken.None
      )

      const expected = expectedSources.concat(expectedQuickFixLiterals)
      const unexpected = expectedSourceLiterals.concat(expectedQuickFixes)
      expect(result).toEqual(expect.arrayContaining(expected))
      expect(result).toEqual(expect.not.arrayContaining(unexpected))
    })
  })
})

describe("buildExecuteCommandHandler", () => {
  let connection: IConnection
  let messageQueue: import("./buffered-message-queue").default
  let documents: TextDocuments
  let settings: Settings
  let onExecuteCommandHandler: RequestHandler<ExecuteCommandParams, any, void>
  let document: TextDocument
  let textEdit: TextEdit
  beforeAll(() => {
    connection = createConnection()
    messageQueue = new BufferedMessageQueue(connection)
    documents = new TextDocuments()
    settings = new Settings(connection)
    onExecuteCommandHandler = buildExecuteCommandHandler(
      connection,
      messageQueue,
      documents,
      settings
    )

    // returns the mocked document from __mocks__/vscode-languageserver.ts
    const getDocumentMock = documents.get as jest.Mock
    document = documents.get("file://path/to/file") as TextDocument
    getDocumentMock.mockClear()

    textEdit = {
      range: Range.create(Position.create(1, 5), Position.create(1, 5)),
      newText: "TextEdit",
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test("applyAutoFixes", async () => {
    const autoFixMock = autoFix as jest.Mock
    const edits = [textEdit]
    autoFixMock.mockReturnValueOnce(Promise.resolve(edits))

    await onExecuteCommandHandler(
      {
        command: CommandIds.applyAutoFixes,
        arguments: [{ uri: document.uri }],
      },
      CancellationToken.None
    )

    expect(documents.get).toHaveBeenCalledTimes(2)
    expect(settings.resolve).toHaveBeenCalledTimes(1)
    expect(autoFix).toHaveBeenCalledTimes(1)
    expect(connection.workspace.applyEdit).toHaveBeenCalledTimes(1)
    expect(connection.workspace.applyEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          changes: {
            [document.uri]: edits,
          },
        },
      })
    )
    expect(validateDocument).toHaveBeenCalledTimes(1)
  })

  test.each(Object.keys(DISABLE_RULE_TEXT_EDITS))("%s", async command => {
    const edits = [textEdit]
    const spy = jest
      .spyOn(DISABLE_RULE_TEXT_EDITS, command as DisableRuleCommandIds)
      .mockImplementation(() => edits)

    const rule = "rule"
    await onExecuteCommandHandler(
      {
        command,
        arguments: [{ uri: document.uri }, textEdit.range, rule],
      },
      CancellationToken.None
    )

    expect(documents.get).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(document, textEdit.range, rule)
    expect(connection.workspace.applyEdit).toHaveBeenCalledTimes(1)
    expect(connection.workspace.applyEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          changes: {
            [document.uri]: edits,
          },
        },
      })
    )
    expect(validateDocument).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })
})
