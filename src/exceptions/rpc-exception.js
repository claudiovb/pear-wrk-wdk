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

/** The most errors of a cause chain that are reported. */
const MAX_CAUSES = 8

/** The most properties of one error that are copied to its details. */
const MAX_DETAILS = 16

/** The most characters of a string property that are copied to the details. */
const MAX_DETAIL_LENGTH = 256

/** The name reported for a thrown value that is not an error. */
const DEFAULT_ERROR_NAME = 'Error'

/** Properties that other fields of the description already report. */
const DESCRIBED_KEYS = new Set(['name', 'message', 'stack', 'cause'])

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
 * Describe one thrown value by its name, its message and its simple properties.
 * @param {unknown} error - The thrown value.
 * @param {ERROR_CODES} [reportedCode] - The code that is reported next to the description.
 * @returns {ErrorDescription} The description.
 */
function describeError (error, reportedCode) {
  /** @type {ErrorDescription} */
  const description = {
    name: error instanceof Error ? error.name : DEFAULT_ERROR_NAME,
    message: error instanceof Error ? error.message : String(error)
  }

  if (error !== null && typeof error === 'object') {
    const details = collectDetails(error, reportedCode)

    if (Object.keys(details).length > 0) description.details = details
  }

  return description
}

/**
 * Describe the chain of causes under an error, outermost first.
 * @param {unknown} error - The thrown value.
 * @returns {ErrorDescription[]} The descriptions, at most MAX_CAUSES.
 */
function describeCauses (error) {
  const causes = []
  const seen = new Set([error])

  let current = error

  while (causes.length < MAX_CAUSES) {
    if (current === null || typeof current !== 'object') break

    const cause = current.cause

    if (cause === undefined || cause === null || seen.has(cause)) break

    seen.add(cause)
    causes.push(describeError(cause))

    current = cause
  }

  return causes
}

/**
 * Create the description of an error that is sent to the host.
 * @param {unknown} error - The thrown value.
 * @param {ERROR_CODES} [code] - The code to report when the error has none. Inferred if not provided.
 * @returns {StructuredError} The description.
 */
function createStructuredError (error, code) {
  if (error.code) {
    code = error.code
  } else if (!code) {
    if (error instanceof TypeError) {
      code = ERROR_CODES.BAD_REQUEST
    } else if (error.message && error.message.includes('WDK')) {
      code = ERROR_CODES.WDK_MANAGER_INIT
    } else if (error.message && error.message.includes('balance')) {
      code = ERROR_CODES.ACCOUNT_BALANCES
    } else {
      code = ERROR_CODES.UNKNOWN
    }
  }

  /** @type {StructuredError} */
  const structuredError = { code, ...describeError(error, code) }

  const causes = describeCauses(error)

  if (causes.length > 0) structuredError.causes = causes

  return structuredError
}

/**
 * Convert a thrown value to the error a handler rejects with. Its message is
 * the JSON of the structured error and it carries the code as a property, so
 * the host also receives the code in the field the RPC layer reserves for it.
 * It is always a plain Error: the RPC layer does not answer a request whose
 * handler throws a TypeError, a SyntaxError or a RangeError.
 * @param {unknown} error - The thrown value.
 * @param {ERROR_CODES} [code] - The code to report when the error has none.
 * @returns {Error & { code: ERROR_CODES }} The error to throw.
 */
function toRpcError (error, code) {
  const structuredError = createStructuredError(error, code)

  const rpcError = new Error(JSON.stringify(structuredError))
  rpcError.code = structuredError.code

  return rpcError
}

module.exports = {
  createStructuredError,
  toRpcError
}
