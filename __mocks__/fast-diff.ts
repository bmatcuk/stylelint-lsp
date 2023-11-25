const { DELETE, EQUAL, INSERT } = jest.requireActual("fast-diff")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fastDiff: any = jest.fn().mockName("fastDiff").mockReturnValue([])
fastDiff.DELETE = DELETE
fastDiff.EQUAL = EQUAL
fastDiff.INSERT = INSERT

export default fastDiff
