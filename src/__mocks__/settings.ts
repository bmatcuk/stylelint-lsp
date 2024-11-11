import stylelint from "stylelint"

export const { defaultClientSettings } = jest.requireActual("../settings")

const defaultServerSettings = {
  ...defaultClientSettings,
  stylelint,
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
    Object.defineProperty(settings, "supportsApplyEdit", {
      get: jest
        .fn()
        .mockName("Settings.supportsApplyEdit")
        .mockReturnValue(true),
    })
    return settings
  })
  .mockName("Settings")
