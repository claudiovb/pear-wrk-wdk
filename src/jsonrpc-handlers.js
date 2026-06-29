const { generateEntropyAndEncryptHandler, getMnemonicFromEntropyHandler, getSeedAndEntropyFromMnemonicHandler, initializeWdkHandler, disposeWdkHandler, registerWalletHandler, registerProtocolHandler, callMethodHandler } = require('./handlers')
const rpcException = require('./exceptions/rpc-exception')
const { safeStringify } = require('./utils/safe-stringify')

/** @typedef {import('../types/rpc').RpcContext} RpcContext */

/**
 * Wrapper for RPC handlers that provides structured error handling
 * Preserves error codes and metadata instead of converting to plain strings
 * @param {Function} handler - The async handler function
 * @param {string} [defaultErrorCode] - Optional default error code
 * @returns {Function} Wrapped handler with error handling
 */
const withErrorHandling = (handler, defaultErrorCode) => {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (error) {
      const structuredError = rpcException.createStructuredError(error, defaultErrorCode)
      const errorMessage = JSON.stringify(structuredError)
      throw new Error(errorMessage)
    }
  }
}

/**
 * Register all JSON-RPC handlers with the provided IPC and context
 * @param {Object} ipc - The BareKit IPC instance
 * @param {RpcContext} context - Context object containing state and dependencies
 */
function registerJsonRpcHandlers (ipc, context) {
  const logger = require('./utils/logger')
  const ERROR_CODES = require('./exceptions/error-codes')

  const withContext = (handler) => {
    return async (req) => {
      return await handler(req, context)
    }
  }

  let readBuffer = Buffer.alloc(0)
  const inflightRequests = new Set()

  function writeFramed (data) {
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(data.length, 0)
    ipc.write(Buffer.concat([length, data]))
  }

  function processFramedData (chunk) {
    readBuffer = Buffer.concat([readBuffer, chunk])

    while (readBuffer.length >= 4) {
      const messageLength = readBuffer.readUInt32BE(0)
      const totalLength = 4 + messageLength
      if (readBuffer.length < totalLength) {
        break
      }

      const messageData = readBuffer.slice(4, totalLength)
      readBuffer = Buffer.from(readBuffer.slice(totalLength))

      try {
        const message = JSON.parse(messageData.toString())
        if (message.jsonrpc === '2.0') {
          handleJsonRpcMessage(message)
        }
      } catch (e) {
        logger.error('Failed to parse framed JSON-RPC message; dropping frame (no response will be sent, client must rely on request timeout):', e)
      }
    }
  }

  async function handleJsonRpcMessage (message) {
    const { id, method, params } = message

    if (id === null || id === undefined) {
      const response = safeStringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          message: 'Request id is required and cannot be null or undefined',
          code: ERROR_CODES.BAD_REQUEST
        }
      })
      writeFramed(Buffer.from(response))
      return
    }

    if (inflightRequests.has(id)) {
      const response = safeStringify({
        jsonrpc: '2.0',
        id,
        error: {
          message: `Request with id ${id} is already being processed`,
          code: ERROR_CODES.DUPLICATE_REQUEST
        }
      })
      writeFramed(Buffer.from(response))
      return
    }

    inflightRequests.add(id)

    try {
      let result
      logger.info(`JSON-RPC request: ${method}`, params)

      switch (method) {
        case 'workletStart':
          result = await withErrorHandling(async () => {
            return { status: 'started' }
          })()
          break

        case 'generateEntropyAndEncrypt':
          result = await withErrorHandling(generateEntropyAndEncryptHandler)(params)
          break

        case 'getMnemonicFromEntropy':
          result = await withErrorHandling(getMnemonicFromEntropyHandler)(params)
          break

        case 'getSeedAndEntropyFromMnemonic':
          result = await withErrorHandling(getSeedAndEntropyFromMnemonicHandler)(params)
          break

        case 'initializeWDK':
          result = await withErrorHandling(withContext(initializeWdkHandler))(params)
          break

        case 'callMethod': {
          const callResult = await withErrorHandling(withContext(callMethodHandler))(params)
          // Handler returns { result: safeStringify(value) } for HRPC compatibility (string-only).
          // For JSON-RPC we parse it back so the transport sends the actual value, not a double-encoded string.
          try {
            result = { result: JSON.parse(callResult.result) }
          } catch (e) {
            logger.error('callMethod result is not valid JSON, returning error response:', e)
            const response = safeStringify({
              jsonrpc: '2.0',
              id,
              error: {
                message: 'callMethod result could not be serialized as JSON',
                code: ERROR_CODES.INTERNAL_ERROR,
                data: { result: callResult.result }
              }
            })
            writeFramed(Buffer.from(response))
            return
          }
          break
        }

        case 'registerWallet':
          result = await withErrorHandling(withContext(registerWalletHandler))(params)
          break

        case 'registerProtocol':
          result = await withErrorHandling(withContext(registerProtocolHandler))(params)
          break

        case 'dispose':
          result = await withErrorHandling(withContext(disposeWdkHandler))(params)
          break

        default:
          throw new Error(`Unknown method: ${method}`)
      }

      logger.info(`JSON-RPC response: ${method}`, result)

      const response = safeStringify({
        jsonrpc: '2.0',
        id,
        result
      })
      writeFramed(Buffer.from(response))
    } catch (error) {
      logger.error(`JSON-RPC error: ${method}`, error)

      let errorResponse
      try {
        const structuredError = JSON.parse(error.message)
        errorResponse = {
          message: structuredError.message,
          code: structuredError.code,
          data: structuredError.data
        }
      } catch (e) {
        errorResponse = {
          message: error.message || String(error),
          code: error.code || ERROR_CODES.INTERNAL_ERROR
        }
      }

      const response = safeStringify({
        jsonrpc: '2.0',
        id,
        error: errorResponse
      })
      writeFramed(Buffer.from(response))
    } finally {
      inflightRequests.delete(id)
    }
  }

  ipc.on('data', (data) => {
    processFramedData(data)
  })

  logger.info('JSON-RPC handlers registered')
}

module.exports = {
  registerJsonRpcHandlers,
  withErrorHandling
}
