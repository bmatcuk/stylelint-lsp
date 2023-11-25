import {
  createConnection,
  ClientCapabilities,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import resolveFrom from "resolve-from"

import Settings, { defaultClientSettings } from "./settings"

const connection = createConnection()
const settings = new Settings(connection)
const document: TextDocument = {
  uri: "file:/path/to/file.ext",
  languageId: "source",
  version: 0,
  getText: jest.fn(),
  positionAt: jest.fn(),
  offsetAt: jest.fn(),
  lineCount: 10,
}

afterEach(() => {
  jest.clearAllMocks()
})

describe("resolve", () => {
  test("does not support configuration requests", async () => {
    settings.initialize({})

    const result = await settings.resolve(document)
    expect(result).toHaveProperty("lint")
    expect(result).toMatchObject(settings["globalSettings"])
    expect(connection.workspace.getConfiguration).not.toHaveBeenCalled()
  })

  test("supports configuration requests", async () => {
    const capabilities = {
      workspace: {
        configuration: true,
      },
    }
    settings.initialize(capabilities as ClientCapabilities)

    const result = settings.resolve(document)
    expect(connection.workspace.getConfiguration).toHaveBeenCalledTimes(1)
    expect(connection.workspace.getConfiguration).toHaveBeenCalledWith({
      scopeUri: document.uri,
      section: "",
    })

    const config = await result
    expect(Object.keys(config)).toEqual([
      ...Object.keys(defaultClientSettings),
      "lint",
    ])

    expect(resolveFrom.silent).toHaveBeenCalledTimes(1)
    expect(resolveFrom.silent).toHaveBeenCalledWith("/path/to", "stylelint")

    expect(settings["documentToSettings"].has(document.uri)).toBeTruthy()
    expect(settings["documentToSettings"].get(document.uri)).toBe(result)
  })
})
