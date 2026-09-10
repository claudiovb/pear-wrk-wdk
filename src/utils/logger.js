/**
 * Simple logger with log levels
 * Supports: debug, info, warn, error
 * Can be configured via environment variables
 *
 * Every argument passes through sanitization before it reaches the console:
 * Error instances are formatted as their stack trace, fields that carry seed
 * encryption material are redacted, and on JSC objects are stringified to work
 * around bare-inspect limitations.
 */

const { safeStringify } = require('./safe-stringify')

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
}

/**
 * Object keys whose values are never written to the console, on any platform
 * and at any log level.
 * @type {Set<string>}
 */
const SECRET_KEYS = new Set([
  'mnemonic',
  'encryptionKey',
  'encryptedSeed',
  'encryptedSeedBuffer',
  'encryptedEntropy',
  'encryptedEntropyBuffer',
  'seed'
])

const REDACTED_PLACEHOLDER = '[redacted]'
const NESTED_OBJECT_PLACEHOLDER = '[object]'
const MAX_REDACT_DEPTH = 3

const barePlatform = globalThis.Bare && globalThis.Bare.platform
const isJSC = barePlatform === 'ios' || barePlatform === 'darwin'

/**
 * Return a copy of a value with every secret field replaced by a placeholder.
 * Plain objects and arrays are walked up to MAX_REDACT_DEPTH levels; typed
 * arrays and primitives are returned as they are.
 * @param {unknown} value - Value to redact
 * @param {number} depth - Current nesting depth
 * @returns {unknown} Redacted copy of the value
 */
function redact (value, depth = 0) {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1))
  }
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) {
    return value
  }
  if (depth >= MAX_REDACT_DEPTH) {
    return NESTED_OBJECT_PLACEHOLDER
  }
  /** @type {Record<string, unknown>} */
  const redacted = {}
  for (const key of Object.keys(value)) {
    redacted[key] = SECRET_KEYS.has(key)
      ? REDACTED_PLACEHOLDER
      : redact(/** @type {Record<string, unknown>} */ (value)[key], depth + 1)
  }
  return redacted
}

/**
 * Format an Error for logging. JSON.stringify would produce "{}" because an
 * Error has no enumerable own properties, so the stack (or name and message)
 * is used instead on every platform.
 * @param {Error} error - Error to format
 * @returns {string} Stack trace, or "name: message" when no stack is available
 */
function formatError (error) {
  return error.stack || `${error.name}: ${error.message}`
}

/**
 * Prepare log arguments for the console: format errors, redact secret fields
 * and, on JSC only, stringify objects. Redaction and stringification are
 * separate steps so that changing one cannot disable the other.
 * @param {unknown[]} args - Arguments passed to a logger method
 * @returns {unknown[]} Sanitized arguments
 */
function sanitizeArgs (args) {
  return args.map((arg) => {
    if (arg instanceof Error) return formatError(arg)
    if (arg === null || typeof arg !== 'object') return arg
    const redacted = redact(arg)
    return isJSC ? safeStringify(redacted) : redacted
  })
}

/**
 * Get current log level from environment. Unrecognized values resolve to
 * ERROR so that a misconfigured environment never enables verbose logging.
 * @returns {number} Current log level
 */
function getLogLevel () {
  if (typeof process === 'undefined' || !process.env) {
    return LOG_LEVELS.ERROR
  }

  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'DEBUG' : 'ERROR')

  switch (level.trim().toUpperCase()) {
    case 'DEBUG':
      return LOG_LEVELS.DEBUG
    case 'INFO':
      return LOG_LEVELS.INFO
    case 'WARN':
      return LOG_LEVELS.WARN
    case 'ERROR':
      return LOG_LEVELS.ERROR
    case 'NONE':
      return LOG_LEVELS.NONE
    default:
      return LOG_LEVELS.ERROR
  }
}

const currentLogLevel = getLogLevel()

/**
 * Logger implementation
 */
const logger = {
  /**
   * Log debug message
   * @param {...any} args - Arguments to log
   */
  debug: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      console.debug('[DEBUG]', ...sanitizeArgs(args))
    }
  },

  /**
   * Log info message
   * @param {...any} args - Arguments to log
   */
  info: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      console.log('[INFO]', ...sanitizeArgs(args))
    }
  },

  /**
   * Log warning message
   * @param {...any} args - Arguments to log
   */
  warn: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      console.warn('[WARN]', ...sanitizeArgs(args))
    }
  },

  /**
   * Log error message
   * @param {...any} args - Arguments to log
   */
  error: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      console.error('[ERROR]', ...sanitizeArgs(args))
    }
  }
}

module.exports = logger
