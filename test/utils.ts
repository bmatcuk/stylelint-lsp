export function getSupportedCodeActionLiteralsMock(
  settings: import("../src/settings").default
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
