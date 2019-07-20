import {
  CancellationToken,
  ErrorCodes,
  GenericNotificationHandler,
  GenericRequestHandler,
  IConnection,
  NotificationHandler,
  NotificationType,
  RPCMessageType,
  RequestHandler,
  RequestType,
  ResponseError,
  VersionedTextDocumentIdentifier,
} from "vscode-languageserver"

/**
 * Tests if a variable is Thenable
 * @param value The variable to test
 * @returns true if value is Thenable
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isThenable<T>(value: any): value is Thenable<T> {
  return value && typeof value.then === "function"
}

/** A queued Request */
export interface Request<TParam, TReturn> {
  /** Method of the Request */
  method: RPCMessageType["method"]

  /** Param sent to the Request handler */
  param: TParam

  /** Version of the document at the time of the Request */
  documentVersion: VersionedTextDocumentIdentifier["version"]

  /** Resolve function for the Request */
  resolve: (value: TReturn | Thenable<TReturn>) => void

  /** Reject function for the Request */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (error?: any) => void

  /** CancellationToken for the Request */
  token?: CancellationToken
}

/**
 * Test if a variable is a Request
 * @param value The variable to test
 * @returns true if value is a Request
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRequest(value: any): value is Request<any, any> {
  return value && value.resolve && value.reject
}

/** A queued Notification */
export interface Notification<TParam> {
  /** Method of the Notification */
  method: RPCMessageType["method"]

  /** Param sent to the Notification handler */
  param: TParam

  /** Version of the document at the time of the Notification */
  documentVersion: VersionedTextDocumentIdentifier["version"]
}

/** A queued Message is either a Request or a Notification */
export type Message<TParam, TReturn> =
  | Request<TParam, TReturn>
  | Notification<TParam>

/**
 * Given the param to a Request or Notification handler, determine the document
 * version.
 * @param param The param to a Request or Notification handler
 * @returns the document version
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VersionLens<TParam> = (
  param: TParam
) => VersionedTextDocumentIdentifier["version"]

/** Maps a Request method to a handler and VersionLens */
export type RequestHandlerMap = Map<
  string,
  {
    /** The handler for the Request */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: GenericRequestHandler<any, any>

    /** The VersionLens for the Request */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    versionLens: VersionLens<any>
  }
>

/** Maps a Notification method to a handler and VersionLens */
export type NotificationHandlerMap = Map<
  string,
  {
    /** The handler for the Notification */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: GenericNotificationHandler

    /** The VersionLens for the Notification */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    versionLens: VersionLens<any>
  }
>

/**
 * Buffers Requests and Notifications such that if the document has changed by
 * the time the Request/Notification is processed, the Request/Notification is
 * cancelled or ignored.
 */
export default class BufferedMessageQueue {
  private connection: IConnection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: Message<any, any>[]
  private requestHandlers: RequestHandlerMap
  private notificationHandlers: NotificationHandlerMap
  private timer?: NodeJS.Immediate

  /**
   * @constructor
   * @param connection An IConnection object
   */
  constructor(connection: IConnection) {
    this.connection = connection
    this.queue = []
    this.requestHandlers = new Map()
    this.notificationHandlers = new Map()
  }

  /**
   * Register a Request handler for the specified Request type.
   * @param type The Request type
   * @param handler The Request handler
   * @param versionLens A VersionLens for the Request
   */
  onRequest<TParam, TReturn, TError, TR0>(
    type: RequestType<TParam, TReturn, TError, TR0>,
    handler: RequestHandler<TParam, TReturn, TError>,
    versionLens: VersionLens<TParam>
  ): void {
    // register a handler with the underlying connection
    this.connection.onRequest(type, (param, token) => {
      return new Promise<TReturn>((resolve, reject) => {
        // enqueue the Request
        this.queue.push({
          method: type.method,
          param,
          documentVersion: versionLens(param),
          resolve,
          reject,
          token,
        })

        // process the message if the queue is idle
        this.next()
      })
    })

    // register the handler/VersionLens
    this.requestHandlers.set(type.method, {
      handler,
      versionLens,
    })
  }

  /**
   * Register a Notification handler for the specified Notification type
   * @param type The Notification type
   * @param handler The Notification handler
   * @param versionLens A VersionLens for the Notification
   */
  onNotification<TParam, TR0>(
    type: NotificationType<TParam, TR0>,
    handler: NotificationHandler<TParam>,
    versionLens: VersionLens<TParam>
  ): void {
    // register a handler with the underlying connection
    this.connection.onNotification(type, param => {
      this.addNotification(type, param, versionLens(param))
    })

    // register the handler/VersionLens
    this.notificationHandlers.set(type.method, {
      handler,
      versionLens,
    })
  }

  /**
   * Inject a Notification into the queue
   * @param type The Notification type
   * @param param The param for the Notification
   * @param documentVersion The current document version
   */
  addNotification<TParam, TR0>(
    type: NotificationType<TParam, TR0>,
    param: TParam,
    documentVersion: VersionedTextDocumentIdentifier["version"]
  ): void {
    // enqueue the Notification
    this.queue.push({
      method: type.method,
      param,
      documentVersion,
    })

    // process the next message if the queue is idle
    this.next()
  }

  /** Start the queue if idle */
  private next(): void {
    if (this.timer || this.queue.length === 0) {
      return
    }

    this.timer = setImmediate(() => {
      this.timer = undefined
      this.popQueue()
    })
  }

  /** Process the next message in the queue */
  private popQueue(): void {
    const message = this.queue.shift()
    if (!message) {
      return
    }

    if (isRequest(message)) {
      // request
      if (message.token && message.token.isCancellationRequested) {
        // Request was cancelled before we could process it
        message.reject(
          new ResponseError(
            ErrorCodes.RequestCancelled,
            "Request was cancelled."
          )
        )
        return
      }

      // fetch the handler and VersionLens
      const handlerAndLens = this.requestHandlers.get(message.method)
      if (!handlerAndLens) {
        return
      }

      const { handler, versionLens } = handlerAndLens
      if (message.documentVersion !== versionLens(message.param)) {
        // Document has changed since the Request was made; cancel
        message.reject(
          new ResponseError(
            ErrorCodes.RequestCancelled,
            "Request was cancelled."
          )
        )
        return
      }

      // send Request to handler
      const result = handler(message.param, message.token)
      if (isThenable(result)) {
        result.then(
          value => {
            message.resolve(value)
          },
          error => {
            message.reject(error)
          }
        )
      } else {
        message.resolve(result)
      }
    } else {
      // notification
      const handlerAndLens = this.notificationHandlers.get(message.method)
      if (!handlerAndLens) {
        return
      }

      const { handler, versionLens } = handlerAndLens
      if (message.documentVersion !== versionLens(message.param)) {
        // Document has changed since the Notification was made; cancel
        return
      }

      // send Notification to handler
      handler(message.param)
    }

    // process next message
    this.next()
  }
}
