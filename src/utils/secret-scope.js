const { memzero } = require('./crypto')

/**
 * Tracks secret-bearing buffers for automatic zeroing on scope exit.
 *
 * Every buffer passed to track() gets memzero'd when close() runs, unless
 * release() was called on it first (because it's being returned or handed
 * off to a caller and must survive). Pair with try/finally:
 *
 *   const scope = createSecretScope()
 *   try {
 *     const secret = scope.track(decrypt(...))
 *     ...
 *     return scope.release(secret) // kept alive, not zeroed
 *   } finally {
 *     scope.close()
 *   }
 *
 * RAII for secrets: zeroing is a property of the scope, not of any
 * particular branch. Track it once, at birth, and it is zeroed no matter
 * how the function leaves.
 *
 * @returns {{ track: Function, release: Function, close: Function }}
 */
function createSecretScope () {
  const tracked = new Set()

  return {
    /**
     * @template {Buffer | Uint8Array | ArrayBuffer} T
     * @param {T} buffer - Buffer to zero on close(), unless released first
     * @returns {T} The same buffer, for inline use
     */
    track (buffer) {
      if (buffer) tracked.add(buffer)
      return buffer
    },

    /**
     * Stop tracking a buffer so close() won't zero it.
     * @template {Buffer | Uint8Array | ArrayBuffer} T
     * @param {T} buffer - Buffer to exempt from zeroing
     * @returns {T} The same buffer, for inline use
     */
    release (buffer) {
      tracked.delete(buffer)
      return buffer
    },

    /**
     * Zero every buffer still tracked. Idempotent and safe to call
     * unconditionally from a finally block.
     */
    close () {
      for (const buffer of tracked) memzero(buffer)
      tracked.clear()
    }
  }
}

module.exports = { createSecretScope }
