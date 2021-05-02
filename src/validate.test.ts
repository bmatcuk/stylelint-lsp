import { Position, Range, TextEdit } from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"
import stylelint from "stylelint"
import fastDiff from "fast-diff"

import {
  autoFix,
  validateAll,
  validateDocument,
  validateNotification,
} from "./validate"
import { ServerSettings, defaultClientSettings } from "./settings"
const { default: BufferedMessageQueue } = jest.genMockFromModule(
  "./buffered-message-queue"
)

const defaultServerSettings: ServerSettings = {
  ...defaultClientSettings,
  lint: stylelint.lint,
}

const document: TextDocument = {
  uri: "file://path/to/file",
  languageId: "source",
  version: 0,
  getText: jest.fn(),
  positionAt: jest.fn((pos) => Position.create(0, pos)),
  offsetAt: jest.fn(),
  lineCount: 10,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asMock(obj: any): jest.Mock {
  return obj as jest.Mock
}

afterEach(() => {
  jest.clearAllMocks()
})

describe("autoFix", () => {
  test("file ignored", async () => {
    const result = await autoFix(document, defaultServerSettings)
    expect(fastDiff).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  test("no output", async () => {
    asMock(stylelint.lint).mockReturnValueOnce(
      Promise.resolve({
        output: "",
        results: [{}],
      })
    )

    const result = await autoFix(document, defaultServerSettings)
    expect(fastDiff).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  test("no changes", async () => {
    asMock(stylelint.lint).mockReturnValueOnce(
      Promise.resolve({
        output: "...",
        results: [{}],
      })
    )

    const result = await autoFix(document, defaultServerSettings)
    expect(fastDiff).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  test("with changes", async () => {
    asMock(stylelint.lint).mockReturnValueOnce(
      Promise.resolve({
        output: "...",
        results: [{}],
      })
    )

    // original string: 123456789345678234
    // modified string: 123789012345901567
    asMock(fastDiff).mockReturnValueOnce([
      [fastDiff.EQUAL, "123"],
      [fastDiff.DELETE, "456"], // delete @3-6
      [fastDiff.EQUAL, "789"],
      [fastDiff.INSERT, "012"], // insert @9
      [fastDiff.EQUAL, "345"],
      [fastDiff.DELETE, "678"], // these four should combine:
      [fastDiff.INSERT, "901"], // change @12-16
      [fastDiff.DELETE, "234"], // new text: 901567
      [fastDiff.INSERT, "567"],
    ])

    const result = await autoFix(document, defaultServerSettings)
    expect(fastDiff).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      TextEdit.del(Range.create(Position.create(0, 3), Position.create(0, 6))),
      TextEdit.insert(Position.create(0, 9), "012"),
      TextEdit.replace(
        Range.create(Position.create(0, 12), Position.create(0, 18)),
        "901567"
      ),
    ])
  })
})

test("validateDocument", () => {
  const queue = new BufferedMessageQueue()
  validateDocument(queue, document)
  expect(queue.addNotification).toHaveBeenCalledTimes(1)
  expect(queue.addNotification).toHaveBeenCalledWith(
    validateNotification,
    document,
    document.version
  )
})

test("validateAll", () => {
  const queue = new BufferedMessageQueue()
  const documents = [document]
  validateAll(queue, documents)
  expect(queue.addNotification).toHaveBeenCalledTimes(1)
  expect(queue.addNotification).toHaveBeenCalledWith(
    validateNotification,
    document,
    document.version
  )
})
