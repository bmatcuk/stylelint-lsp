export default {
  silent: jest
    .fn()
    .mockName("resolve-from.silent")
    .mockReturnValue(null),
}
