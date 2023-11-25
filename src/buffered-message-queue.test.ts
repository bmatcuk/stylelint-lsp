import {
  CancellationToken,
  Connection,
  NotificationType,
  RequestType,
  ResponseError,
  createConnection,
} from "vscode-languageserver/node"

import BufferedMessageQueue, {
  isThenable,
  isRequest,
  Request,
  Notification,
} from "./buffered-message-queue"

const testRequest = new RequestType<void, void, Error>("test")
const testNotification = new NotificationType<void>("test")

describe("isThenable", () => {
  test("Promise is Thenable", () => {
    const promise = new Promise<void>((resolve) => resolve())
    expect(isThenable(promise)).toBeTruthy()
  })
})

describe("isRequest", () => {
  test("Object is a Request", () => {
    const obj: Partial<Request<void, void>> = {}
    new Promise((resolve, reject) => {
      obj.resolve = resolve
      obj.reject = reject
    })
    expect(isRequest(obj)).toBeTruthy()
  })
})

describe("BufferedMessageQueue", () => {
  let connection: Connection
  let queue: BufferedMessageQueue
  beforeEach(() => {
    connection = createConnection()
    queue = new BufferedMessageQueue(connection)
  })

  test("onRequest", () => {
    queue.onRequest(
      testRequest,
      () => {},
      () => 0
    )
    expect(connection.onRequest).toHaveBeenCalledTimes(1)
    expect(connection.onRequest).toHaveBeenCalledWith(
      testRequest,
      expect.anything()
    )
  })

  test("onNotification", () => {
    queue.onNotification(
      testNotification,
      () => {},
      () => 0
    )
    expect(connection.onNotification).toHaveBeenCalledTimes(1)
    expect(connection.onNotification).toHaveBeenCalledWith(
      testNotification,
      expect.anything()
    )
  })

  test("addNotification", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queuePushSpy = jest.spyOn(queue["queue"], "push" as any)
    queue["next"] = jest.fn()
    queue.addNotification(testNotification, undefined, 0)
    expect(queuePushSpy).toHaveBeenCalledTimes(1)
    expect(queuePushSpy).toHaveBeenCalledWith({
      method: testNotification.method,
      param: undefined,
      documentVersion: 0,
    })
    expect(queue["next"]).toHaveBeenCalledTimes(1)
  })

  describe("next", () => {
    beforeEach(() => {
      jest.useFakeTimers({ legacyFakeTimers: true })
      queue["queue"].push({
        method: testNotification.method,
        param: undefined,
        documentVersion: 0,
      })
    })

    test("does nothing if queue is empty", () => {
      queue["queue"].length = 0
      queue["next"]()
      expect(setImmediate).not.toHaveBeenCalled()
      expect(queue["timer"]).toBeUndefined()
    })

    test("calls popQueue via a timer", () => {
      queue["popQueue"] = jest.fn()
      queue["next"]()
      expect(setImmediate).toHaveBeenCalledTimes(1)
      expect(queue["timer"]).not.toBeUndefined()

      jest.runOnlyPendingTimers()
      expect(queue["popQueue"]).toHaveBeenCalledTimes(1)
      expect(queue["timer"]).toBeUndefined()
    })

    test("does nothing if a timer is already set", () => {
      queue["next"]()
      queue["next"]()
      expect(queue["timer"]).not.toBeUndefined()
      expect(setImmediate).toHaveBeenCalledTimes(1)
    })
  })

  describe("popQueue", () => {
    const documentVersion = 0
    let next: jest.Mock
    let handler: jest.Mock
    let versionLens: jest.Mock
    describe("request", () => {
      let request: Request<undefined, undefined>
      beforeEach(() => {
        queue["next"] = next = jest.fn()
        handler = jest.fn()
        versionLens = jest.fn(() => documentVersion)
        queue.onRequest(testRequest, handler, versionLens)

        request = {
          method: testRequest.method,
          param: undefined,
          documentVersion,
          resolve: jest.fn(),
          reject: jest.fn(),
        }
        queue["queue"].push(request)
      })

      test("rejects if request has been cancelled", () => {
        request.token = CancellationToken.Cancelled
        queue["popQueue"]()
        expect(request.reject).toHaveBeenCalledTimes(1)
        expect(request.reject).toHaveBeenCalledWith(expect.any(ResponseError))
        expect(next).toHaveBeenCalled()
      })

      test("rejects if outdated version", () => {
        versionLens.mockImplementation(() => documentVersion + 1)
        queue["popQueue"]()
        expect(request.reject).toHaveBeenCalledTimes(1)
        expect(request.reject).toHaveBeenCalledWith(expect.any(ResponseError))
        expect(next).toHaveBeenCalled()
      })

      test("calls handler and resolves", () => {
        queue["popQueue"]()
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith(request.param, request.token)
        expect(request.resolve).toHaveBeenCalledTimes(1)
        expect(next).toHaveBeenCalled()
      })
    })

    describe("notification", () => {
      let notification: Notification<undefined>
      beforeEach(() => {
        handler = jest.fn()
        versionLens = jest.fn(() => documentVersion)
        queue.onNotification(testNotification, handler, versionLens)

        notification = {
          method: testNotification.method,
          param: undefined,
          documentVersion,
        }
        queue["queue"].push(notification)
      })

      test("does not run handler if outdated version", () => {
        versionLens.mockImplementation(() => documentVersion + 1)
        queue["popQueue"]()
        expect(handler).not.toHaveBeenCalled()
        expect(next).toHaveBeenCalled()
      })

      test("calls handler", () => {
        queue["popQueue"]()
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith(notification.param)
        expect(next).toHaveBeenCalled()
      })
    })
  })
})
