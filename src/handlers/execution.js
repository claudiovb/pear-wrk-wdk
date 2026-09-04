const ERROR_CODES = require('../exceptions/error-codes')
const logger = require('../utils/logger')
const { safeStringify } = require('../utils/safe-stringify')
const { validateNonEmptyString, validateNonNegativeInteger, validateJSON, validateRequest, createErrorWithCode } = require('../utils/validation')

/** @typedef {import('../../types/rpc').CallMethodRequest} CallMethodRequest */
/** @typedef {import('../../types/rpc').CallMethodResponse} CallMethodResponse */
/** @typedef {import('../../types/rpc').CallMethodOptions} CallMethodOptions */
/** @typedef {import('../../types/rpc').RpcContext} RpcContext */

const PROTOCOL_ACCESSORS = {
  swap: 'getSwapProtocol',
  bridge: 'getBridgeProtocol',
  lending: 'getLendingProtocol',
  fiat: 'getFiatProtocol',
  swidge: 'getSwidgeProtocol'
}

function isProtocolSurface (options) {
  return Boolean(options?.protocolType && PROTOCOL_ACCESSORS[options.protocolType] && options?.protocolName)
}

/**
 * Whether methodName is permitted for this network/protocol surface. With no
 * context.allowedMethods (or no entry for this surface), everything is allowed.
 *
 * @param {RpcContext} context
 * @param {string} network
 * @param {string} methodName
 * @param {CallMethodOptions} options
 * @returns {boolean}
 */
function isMethodAllowed (context, network, methodName, options) {
  const allowedForNetwork = context.allowedMethods?.[network]
  const allowedForSurface = isProtocolSurface(options)
    ? allowedForNetwork?.protocols?.[options.protocolType]?.[options.protocolName]?.methods
    : allowedForNetwork?.methods

  return !allowedForSurface || (Array.isArray(allowedForSurface) && allowedForSurface.includes(methodName))
}

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

  if (!isMethodAllowed(context, network, methodName, options)) {
    throw createErrorWithCode(
      `Method "${methodName}" is not allowed for network "${network}".`,
      ERROR_CODES.METHOD_NOT_ALLOWED
    )
  }

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

  const protocolAccessor = PROTOCOL_ACCESSORS[options?.protocolType]
  if (protocolAccessor) {
    if (!options?.protocolName) {
      throw createErrorWithCode(`Protocol name is required for ${options.protocolType} protocol`, ERROR_CODES.BAD_REQUEST)
    }
    account = account[protocolAccessor](options.protocolName)
  }

  if (typeof account[methodName] !== 'function') {
    throw createErrorWithCode(
      `Method "${methodName}" not found on account for network "${network}".`,
      ERROR_CODES.BAD_REQUEST
    )
  }

  // args is arbitrary, caller-supplied data for whatever WDK account method
  // is being invoked — it can legitimately hold a bare secret (e.g. a
  // private key passed positionally, with no field name to redact by), so
  // this stays at debug level (off by default) rather than info.
  logger.debug('Args:', args)

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
