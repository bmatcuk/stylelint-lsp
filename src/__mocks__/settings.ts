import stylelint from "stylelint"

export const { defaultClientSettings } = jest.requireActual("../settings")

const defaultServerSettings = {
  ...defaultClientSettings,
  stylelint,
}

export function getSupportedCodeActionLiteralsMock(
  settings: import("../settings").default
): jest.Mock {
  const descriptor = Object.getOwnPropertyDescriptor(
    settings,
    "supportedCodeActionLiterals"
  )
  if (descriptor && descriptor.get) {
    return descriptor.get as jest.Mock
  }
  throw new Error("Argument `settings` is not a Settings object")
}

export default jest
  .fn(() => {
    const settings = {
      initialize: jest.fn().mockName("Settings.initialize"),
      resolve: jest
        .fn()
        .mockName("Settings.resolve")
        .mockReturnValue(Promise.resolve(defaultServerSettings)),
      clientConfigurationChanged: jest
        .fn()
        .mockName("Settings.clientConfigurationChanged"),
      closeDocument: jest.fn().mockName("closeDocument"),
    }
    Object.defineProperty(settings, "supportedCodeActionLiterals", {
      get: jest
        .fn()
        .mockName("Settings.supportedCodeActionLiterals")
        .mockReturnValue([]),
    })
    return settings
  })
  .mockName("Settings")
