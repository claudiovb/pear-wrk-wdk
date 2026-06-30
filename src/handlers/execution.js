const ERROR_CODES = require('../exceptions/error-codes')
const logger = require('../utils/logger')
const { safeStringify } = require('../utils/safe-stringify')
const { validateNonEmptyString, validateNonNegativeInteger, validateJSON, validateRequest, createErrorWithCode } = require('../utils/validation')

/** @typedef {import('../../types/rpc').CallMethodRequest} CallMethodRequest */
/** @typedef {import('../../types/rpc').CallMethodResponse} CallMethodResponse */
/** @typedef {import('../../types/rpc').CallMethodOptions} CallMethodOptions */
/** @typedef {import('../../types/rpc').RpcContext} RpcContext */

/**
 * @param {CallMethodRequest} payload
 * @param {RpcContext} context
 * @returns {Promise<CallMethodResponse>}
 */
async function callMethodHandler (payload, context) {
  const {
    methodName,
    network,
    accountIndex,
    args: argsJson,
    options: optionsJson
  } = payload

  let args, options

  validateRequest(
    payload,
    () => {
      validateNonEmptyString(methodName, 'methodName')
      validateNonEmptyString(network, 'network')
      validateNonNegativeInteger(accountIndex, 'accountIndex')

      // Parse args if provided (JSON string)
      /** @type {CallMethodRequest.args} */
      args = argsJson ? validateJSON(argsJson, 'args') : null
      options = optionsJson ? validateJSON(optionsJson, 'options') : null
    },
    'Payload'
  )

  const result = await callWdkMethod({
    context,
    methodName,
    network,
    accountIndex,
    args,
    options
  })

  return { result: safeStringify(result) }
}

/**
 * Generalized function to call any WDK account method
 * This provides a dev-friendly way to call account methods without needing individual handlers
 *
 * @param {CallMethodRequest & { context: RpcContext, args?: any, options: CallMethodOptions }} request
 * @param {RpcContext} context
 * @returns {Promise<any>} The result from the account method
 */
const callWdkMethod = async ({ context, methodName, network, accountIndex, args = null, options = {} }) => {
  const { wdk } = context

  if (!wdk) {
    throw createErrorWithCode('WDK not initialized. Call initializeWDK first.', ERROR_CODES.WDK_MANAGER_INIT)
  }

  if (!network || typeof network !== 'string' || network.trim().length === 0) {
    throw createErrorWithCode('Network must be a non-empty string', ERROR_CODES.BAD_REQUEST)
  }

  let account
  try {
    account = await wdk.getAccount(network, accountIndex)
  } catch (error) {
    throw createErrorWithCode(
      `Failed to get account for network "${network}" at index ${accountIndex}: ${error.message}`,
      ERROR_CODES.ACCOUNT_BALANCES
    )
  }

  switch (options?.protocolType) {
    case 'swap':
      if (!options?.protocolName) {
        throw createErrorWithCode('Protocol name is required for swap protocol', ERROR_CODES.BAD_REQUEST)
      }
      account = account.getSwapProtocol(options?.protocolName)
      break
    case 'bridge':
      if (!options?.protocolName) {
        throw createErrorWithCode('Protocol name is required for bridge protocol', ERROR_CODES.BAD_REQUEST)
      }
      account = account.getBridgeProtocol(options?.protocolName)
      break
    case 'lending':
      if (!options?.protocolName) {
        throw createErrorWithCode('Protocol name is required for lending protocol', ERROR_CODES.BAD_REQUEST)
      }
      account = account.getLendingProtocol(options?.protocolName)
      break
    case 'fiat':
      if (!options?.protocolName) {
        throw createErrorWithCode('Protocol name is required for fiat protocol', ERROR_CODES.BAD_REQUEST)
      }
      account = account.getFiatProtocol(options?.protocolName)
      break
  }

  if (typeof account[methodName] !== 'function') {
    if (options?.defaultValue !== undefined) {
      logger.error(`${methodName} not available for network: ${network}, returning default value`)
      return options.defaultValue
    }

    const availableMethods = Object.keys(account)
      .filter(key => typeof account[key] === 'function')
      .join(', ')
    throw createErrorWithCode(
      `Method "${methodName}" not found on account for network "${network}". ` +
      `Available methods: ${availableMethods}`,
      ERROR_CODES.BAD_REQUEST
    )
  }

  logger.info('Args:', args)

  // JSC (iOS/macOS) has a native-call optimization in bare-inspect's binding
  // that ignores JS-side property overrides and dispatches directly to the
  // native getOwnNonIndexPropertyNames implementation, which throws
  // "Unsupported operation" when given certain prototype objects. To keep
  // V8 (Android) logging quality, structured-log on V8 and string-log on JSC.
  const proto = Object.getPrototypeOf(account)
  const barePlatform = globalThis.Bare && globalThis.Bare.platform
  const isJSC = barePlatform === 'ios' || barePlatform === 'darwin'
  if (isJSC) {
    logger.info(
      `account: constructor=${proto?.constructor?.name} ` +
      `protoKeys=[${Object.getOwnPropertyNames(proto).join(',')}]`
    )
  } else {
    logger.info({
      constructor: proto?.constructor?.name,
      protoKeys: Object.getOwnPropertyNames(proto)
    })
  }

  // Support array args for multi-parameter methods (e.g., transfer(options, config))
  // - Array: spread as positional arguments -> method(arg1, arg2, ...)
  // - Non-array (object/primitive): pass as single argument -> method(args)
  // - null/undefined: call with no arguments -> method()
  const argsArray = Array.isArray(args) ? args : (args !== null && args !== undefined ? [args] : [])
  const result = await account[methodName](...argsArray)

  if (options?.transformResult) {
    return options.transformResult(result)
  }

  return result
}

module.exports = {
  callMethodHandler
}
