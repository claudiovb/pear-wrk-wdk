/**
 * Securely zero out sensitive memory (memzero)
 * Note: In JavaScript/V8, this may not be fully effective due to garbage collection
 * and memory management, but it's still good practice for security-sensitive code.
 * It lives in its own module, apart from crypto.js, so that code which also runs
 * outside Bare can use it without loading bare-crypto.
 * @param {Buffer | Uint8Array | ArrayBuffer} buffer - Buffer to zero out
 */
const memzero = (buffer) => {
  if (!buffer) return

  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0)
  } else if (buffer instanceof Uint8Array) {
    buffer.fill(0)
  } else if (buffer instanceof ArrayBuffer) {
    new Uint8Array(buffer).fill(0)
  } else if (buffer.buffer instanceof ArrayBuffer) {
    // Handle TypedArray views
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0)
  }
}

module.exports = memzero
