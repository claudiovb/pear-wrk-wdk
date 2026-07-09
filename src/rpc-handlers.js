const { generateEntropyAndEncryptHandler, getMnemonicFromEntropyHandler, getSeedAndEntropyFromMnemonicHandler, initializeWdkHandler, resetWdkWallets, disposeWdkHandler, registerWalletHandler, registerProtocolHandler, callMethodHandler, createModuleRuntime } = require('./handlers')
const rpcException = require('./exceptions/rpc-exception')

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
      // Create structured error response
      const structuredError = rpcException.createStructuredError(error, defaultErrorCode)
      // Throw as Error with structured data in message (for RPC transport)
      // The RPC layer will handle serialization
      const errorMessage = JSON.stringify(structuredError)
      throw new Error(errorMessage)
    }
  }
}

/**
 * Register all RPC handlers with the provided RPC instance
 * @param {any} rpc - The HRPC instance
 * @param {RpcContext} context - Context object containing state and dependencies
 */
function registerRpcHandlers (rpc, context) {
  const withContext = (handler) => {
    return async (req) => {
      return await handler(req, context)
    }
  }

  /**
   * @deprecated
   * Generate entropy and encrypt seed buffer and entropy
   */
  rpc.onWorkletStart(withErrorHandling(async (init) => {
    // workletStart no longer initializes WDK - that's done via initializeWDK
    return { status: 'started' }
  }))

  /**
   * Generate entropy and encrypt seed buffer and entropy
   */
  rpc.onGenerateEntropyAndEncrypt(withErrorHandling(generateEntropyAndEncryptHandler))

  /**
   * Get mnemonic phrase from encrypted entropy
   */
  rpc.onGetMnemonicFromEntropy(withErrorHandling(getMnemonicFromEntropyHandler))

  /**
   * RPC handler: Convert mnemonic phrase to encrypted seed and entropy
   */
  rpc.onGetSeedAndEntropyFromMnemonic(withErrorHandling(getSeedAndEntropyFromMnemonicHandler))

  /**
   * Initialize WDK with either encryptionKey + encryptedSeed
   */
  rpc.onInitializeWDK(withErrorHandling(withContext(initializeWdkHandler)))

  /**
   * Generic handler for all WDK account methods
   * This single handler can call any method on any WDK account dynamically
   * No special handling - just calls the method and returns the raw result
   */
  rpc.onCallMethod(withErrorHandling(withContext(callMethodHandler)))

  rpc.onRegisterWallet(withErrorHandling(withContext(registerWalletHandler)))

  rpc.onRegisterProtocol(withErrorHandling(withContext(registerProtocolHandler)))

  rpc.onDispose(withErrorHandling(withContext(disposeWdkHandler)))

  rpc.onResetWdkWallets(withErrorHandling(withContext(resetWdkWallets)))

  // Generic module subsystem (only when modules are bundled). Modules are
  // constructed from config at WDK init (lifecycle.js); here we expose the
  // runtime on the context and wire the per-instance handlers.
  if (context.moduleManagers && Object.keys(context.moduleManagers).length > 0) {
    const moduleRuntime = createModuleRuntime(rpc, context)
    context.moduleRuntime = moduleRuntime
    rpc.onCallModule(withErrorHandling(moduleRuntime.callModule))
  }
}

module.exports = {
  registerRpcHandlers
}
