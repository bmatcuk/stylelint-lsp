export default {
  lint: jest
    .fn()
    .mockName("stylelint.lint")
    .mockReturnValue(
      Promise.resolve({
        results: [
          {
            ignored: true,
          },
        ],
      })
    ),
}
