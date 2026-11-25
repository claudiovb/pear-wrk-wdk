const ERROR_CODES = require('./error-codes')
const SECRET_KEYS = require('../utils/secret-keys')

/**
 * The simple properties copied from one error.
 * @typedef {Record<string, string | number | boolean>} ErrorDetails
 */

/**
 * @typedef {Object} ErrorDescription
 * @property {string} name - The error's name.
 * @property {string} message - The error's message.
 * @property {ErrorDetails} [details] - The error's simple properties. Left out when there is none.
 * @property {string} [stack] - The error's stack trace. Only in a debug build.
 */

/**
 * @typedef {Object} StructuredErrorFields
 * @property {ERROR_CODES} code - The error code.
 * @property {ErrorDescription[]} [causes] - The errors under the thrown one, outermost first. Left out when there is none.
 */

/**
 * The description of an error that is sent to the host.
 * @typedef {ErrorDescription & StructuredErrorFields} StructuredError
 */

/**
 * @typedef {Object} StructuredErrorOptions
 * @property {ERROR_CODES} [defaultCode=ERROR_CODES.INTERNAL_ERROR] - The code to report when the error carries none of ours.
 * @property {boolean} [debug=false] - Whether to report the stack trace of each error. For debug builds only.
 */

/** The most errors of a cause chain that are reported. */
const MAX_CAUSES = 8

/** The most properties of one error that are copied to its details. */
const MAX_DETAILS = 16

/** The most characters of a string property that are copied to the details. */
const MAX_DETAIL_LENGTH = 256

/** The most characters of a stack trace that are reported. */
const MAX_STACK_LENGTH = 4096

/** The most characters of a name that are reported. */
const MAX_NAME_LENGTH = 128

/** The most characters of a message that are reported. */
const MAX_MESSAGE_LENGTH = 4096

/** The name reported for a thrown value that is not an error. */
const DEFAULT_ERROR_NAME = 'Error'

/** Properties that other fields of the description already report. */
const DESCRIBED_KEYS = new Set(['name', 'message', 'stack', 'cause'])

/** The codes of this worklet, as opposed to a code set by a library. */
const OWN_CODES = new Set(Object.values(ERROR_CODES))

/** The message reported when describing a thrown value fails. */
const UNDESCRIBABLE_ERROR_MESSAGE = 'The error could not be described'

/**
 * The errors toRpcError has made, so that converting one of them again
 * returns it as it is.
 * @type {WeakSet<Error>}
 */
const RPC_ERRORS = new WeakSet()

/**
 * An error thrown by code the worklet calls but does not own: a wallet, a
 * protocol or a module. It pairs the thrown value, kept as its cause, with
 * the code that says which kind of call failed. The thrown value itself is
 * what gets described to the host.
 */
class ExternalError extends Error {
  /**
   * @param {ERROR_CODES} code - The code to report for the thrown value.
   * @param {unknown} cause - The thrown value.
   */
  constructor (code, cause) {
    super('An external call failed', { cause })

    this.name = 'ExternalError'

    /**
     * The code to report for the thrown value.
     * @type {ERROR_CODES}
     */
    this.code = code
  }
}

/**
 * Call code the worklet does not own and report what it throws under a code.
 * @template T
 * @param {ERROR_CODES} code - The code to report for a thrown value.
 * @param {() => T | Promise<T>} call - The call to make.
 * @returns {Promise<T>} The result of the call.
 * @throws {ExternalError} If the call throws.
 */
async function callExternal (code, call) {
  try {
    return await call()
  } catch (error) {
    throw new ExternalError(code, error)
  }
}

/**
 * Copy the simple properties of an error: strings, finite numbers and booleans.
 * Objects, arrays and functions are skipped, so a request or a response body
 * attached to an error never leaves the worklet, and so are the secret fields.
 * @param {object} error - The error to copy the properties of.
 * @param {ERROR_CODES} [reportedCode] - The code that is reported next to the details. A `code` property equal to it is not repeated.
 * @returns {ErrorDetails} The copied properties.
 */
function collectDetails (error, reportedCode) {
  /** @type {ErrorDetails} */
  const details = {}
  let count = 0

  for (const key of Object.keys(error)) {
    if (count === MAX_DETAILS) break
    if (DESCRIBED_KEYS.has(key) || SECRET_KEYS.has(key)) continue

    const value = error[key]

    if (key === 'code' && value === reportedCode) continue

    if (typeof value === 'string') {
      details[key] = value.slice(0, MAX_DETAIL_LENGTH)
    } else if (typeof value === 'boolean' || Number.isFinite(value)) {
      details[key] = value
    } else {
      continue
    }

    count++
  }

  return details
}

/**
 * Describe a message that is not a string by its JSON, cut like a detail.
 * The secret fields and the byte arrays in it are left out. A value JSON
 * cannot describe (a function, a cycle) gives an empty message.
 * @param {unknown} message - The message of a thrown object.
 * @returns {string} The text that is reported.
 */
function serializeMessage (message) {
  try {
    // A function, not an arrow: `this[key]` is the value before its toJSON().
    const text = JSON.stringify(message, function (key, value) {
      if (SECRET_KEYS.has(key) || ArrayBuffer.isView(this[key])) return undefined

      return typeof value === 'bigint' ? value.toString() : value
    })

    return typeof text === 'string' ? text.slice(0, MAX_DETAIL_LENGTH) : ''
  } catch {
    return ''
  }
}

/**
 * Describe one thrown value by its name, its message and its simple properties.
 *
 * The name and the message are always strings, cut at a fixed length. A
 * library can throw an object that is not an Error (a JSON-RPC error, for
 * example), so they are read from any object. A name that is not a string
 * is not reported. A message that is not a string is reported as its JSON
 * (see serializeMessage). A value that is not an object is reported as text.
 * @param {unknown} error - The thrown value.
 * @param {Object} [options]
 * @param {ERROR_CODES} [options.reportedCode] - The code that is reported next to the description.
 * @param {boolean} [options.debug=false] - Whether to report the stack trace.
 * @returns {ErrorDescription} The description.
 */
function describeError (error, { reportedCode, debug = false } = {}) {
  const isObject = error !== null && typeof error === 'object'

  const name = isObject && typeof error.name === 'string' ? error.name : DEFAULT_ERROR_NAME

  let message = ''
  if (!isObject) message = String(error)
  else if (typeof error.message === 'string') message = error.message
  else if (error.message != null) message = serializeMessage(error.message)

  /** @type {ErrorDescription} */
  const description = {
    name: name.slice(0, MAX_NAME_LENGTH),
    message: message.slice(0, MAX_MESSAGE_LENGTH)
  }

  if (isObject) {
    const details = collectDetails(error, reportedCode)

    if (Object.keys(details).length > 0) description.details = details

    if (debug && typeof error.stack === 'string') description.stack = error.stack.slice(0, MAX_STACK_LENGTH)
  }

  return description
}

/**
 * Describe the chain of causes under an error, outermost first.
 * @param {unknown} error - The thrown value.
 * @param {boolean} debug - Whether to report the stack trace of each cause.
 * @returns {ErrorDescription[]} The descriptions, at most MAX_CAUSES.
 */
function describeCauses (error, debug) {
  const causes = []
  const seen = new Set([error])

  let current = error

  while (causes.length < MAX_CAUSES) {
    if (current === null || typeof current !== 'object') break

    const cause = current.cause

    if (cause === undefined || cause === null || seen.has(cause)) break

    seen.add(cause)
    causes.push(describeError(cause, { debug }))

    current = cause
  }

  return causes
}

/**
 * Create the description of an error that is sent to the host. Its code is
 * always one of this worklet's codes: the one an ExternalError carries, the
 * one the worklet set on the error, or the default. A code set by a library
 * is not used as ours; it is reported in the details.
 * @param {unknown} error - The thrown value.
 * @param {StructuredErrorOptions} [options]
 * @returns {StructuredError} The description.
 */
function createStructuredError (error, { defaultCode = ERROR_CODES.INTERNAL_ERROR, debug = false } = {}) {
  let code = defaultCode

  if (error instanceof ExternalError) {
    code = error.code
    error = error.cause
  } else if (error !== null && typeof error === 'object' && OWN_CODES.has(error.code)) {
    code = error.code
  }

  /** @type {StructuredError} */
  const structuredError = { code, ...describeError(error, { reportedCode: code, debug }) }

  const causes = describeCauses(error, debug)

  if (causes.length > 0) structuredError.causes = causes

  return structuredError
}

/**
 * Convert a thrown value to the error a handler rejects with. Its message is
 * the JSON of the structured error and it carries the code as a property, so
 * the host also receives the code in the field the RPC layer reserves for it.
 * It is always a plain Error: the RPC layer does not answer a request whose
 * handler throws a TypeError, a SyntaxError or a RangeError, it rethrows it
 * as an uncaught exception. For the same reason this function never throws:
 * a value that cannot be described is reported as an INTERNAL_ERROR. An error
 * this function returned is returned as it is when converted again.
 * @param {unknown} error - The thrown value.
 * @param {StructuredErrorOptions} [options]
 * @returns {Error & { code: ERROR_CODES }} The error to throw.
 */
function toRpcError (error, options) {
  if (RPC_ERRORS.has(error)) return error

  let code
  let message

  try {
    const structuredError = createStructuredError(error, options)

    code = structuredError.code
    message = JSON.stringify(structuredError)
  } catch {
    code = ERROR_CODES.INTERNAL_ERROR
    message = JSON.stringify({ code, name: DEFAULT_ERROR_NAME, message: UNDESCRIBABLE_ERROR_MESSAGE })
  }

  const rpcError = new Error(message)
  rpcError.code = code

  RPC_ERRORS.add(rpcError)

  return rpcError
}

module.exports = {
  ExternalError,
  callExternal,
  createStructuredError,
  toRpcError
}
