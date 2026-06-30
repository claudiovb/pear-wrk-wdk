/**
 * Simple logger with log levels
 * Supports: debug, info, warn, error
 * Can be configured via environment variables
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
}

/**
 * Get current log level from environment or default to INFO
 * @returns {number} Current log level
 */
function getLogLevel () {
  if (typeof process === 'undefined' || !process.env) {
    return LOG_LEVELS.ERROR
  }

  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'DEBUG' : 'ERROR')

  switch (level.toUpperCase()) {
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
      return LOG_LEVELS.INFO
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
      console.debug('[DEBUG]', ...args)
    }
  },

  /**
   * Log info message
   * @param {...any} args - Arguments to log
   */
  info: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      console.log('[INFO]', ...args)
    }
  },

  /**
   * Log warning message
   * @param {...any} args - Arguments to log
   */
  warn: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      console.warn('[WARN]', ...args)
    }
  },

  /**
   * Log error message
   * @param {...any} args - Arguments to log
   */
  error: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      console.error('[ERROR]', ...args)
    }
  }
}

module.exports = logger
