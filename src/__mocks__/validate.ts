export const { validateNotification } = jest.requireActual("../validate")

export const autoFix = jest
  .fn()
  .mockName("autoFix")
  .mockReturnValue(Promise.resolve([]))

export const validateDocument = jest.fn().mockName("validateDocument")
export const validateAll = jest.fn().mockName("validateAll")

export const registerValidateHandlers = jest
  .fn()
  .mockName("registerValidateHandlers")
