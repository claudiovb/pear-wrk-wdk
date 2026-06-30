// External dependencies
const crypto = require('bare-crypto')

/** @typedef {import('../../types/rpc').WdkEntropyResult} WdkEntropyResult */

/**
 * Buffer Type Strategy:
 * - Functions accept both Buffer and Uint8Array for flexibility
 * - Internally convert to Buffer for crypto operations (Node.js standard)
 * - Uint8Array is used for entropy operations (required by @scure/bip39)
 * - All conversions are handled transparently within this module
 */

/**
 * Securely zero out sensitive memory (memzero)
 * Note: In JavaScript/V8, this may not be fully effective due to garbage collection
 * and memory management, but it's still good practice for security-sensitive code.
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

/**
 * Generate a strong encryption key (32 bytes for AES-256)
 * @returns {string} Base64-encoded encryption key
 */
const generateEncryptionKey = () => {
  const key = crypto.randomBytes(32)
  const keyBase64 = key.toString('base64')
  memzero(key)
  return keyBase64
}

/**
 * Encrypt data using AES-256-GCM
 * @param {Uint8Array | Buffer} data - Data to encrypt
 * @param {Buffer | string} key - Encryption key as Buffer or Base64-encoded string
 * @returns {string} Base64-encoded encrypted data with IV and auth tag.
 *   The returned string cannot be zeroed — treat it as residual heap data
 *   once it is no longer needed.
 */
const encrypt = (data, key) => {
  const iv = crypto.randomBytes(12) // 96-bit IV for GCM

  // Convert key to Buffer if string (only zero the internal copy)
  const keyIsString = typeof key === 'string'
  const keyBuffer = keyIsString ? Buffer.from(key, 'base64') : key

  // Convert data to Buffer if needed (only zero the internal copy)
  const dataIsCopy = !Buffer.isBuffer(data)
  const dataBuffer = dataIsCopy ? Buffer.from(data) : data

  // Use AES-256-GCM for authenticated encryption
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv)
  const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Combine IV + encrypted data + auth tag
  const result = Buffer.concat([iv, encrypted, authTag])
  const resultBase64 = result.toString('base64')

  // Zero out sensitive buffers; caller is responsible for zeroing key/data Buffers they own
  memzero(iv)
  memzero(encrypted)
  memzero(authTag)
  memzero(result)
  if (keyIsString) memzero(keyBuffer)
  if (dataIsCopy) memzero(dataBuffer)

  return resultBase64
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedBase64 - Base64-encoded encrypted data with IV and auth tag
 * @param {Buffer | string} key - Encryption key as Buffer or Base64-encoded string
 * @returns {Buffer} Decrypted data
 */
const decrypt = (encryptedBase64, key) => {
  // Convert key to Buffer if string (only zero the internal copy)
  const keyIsString = typeof key === 'string'
  const keyBuffer = keyIsString ? Buffer.from(key, 'base64') : key

  const encryptedBuffer = Buffer.from(encryptedBase64, 'base64')

  // Extract IV (12 bytes), encrypted data, and auth tag (16 bytes)
  const iv = encryptedBuffer.subarray(0, 12)
  const authTag = encryptedBuffer.subarray(encryptedBuffer.length - 16)
  const encrypted = encryptedBuffer.subarray(12, encryptedBuffer.length - 16)

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

  // Zero out sensitive buffers; caller is responsible for zeroing key Buffer they own
  // iv/authTag/encrypted are subarrays of encryptedBuffer — zeroing it covers all three
  memzero(encryptedBuffer)
  if (keyIsString) memzero(keyBuffer)

  return decrypted
}

/**
 * Generate entropy for a seed phrase
 * @param {number} wordCount - Number of words (12 or 24)
 * @returns {Uint8Array} Entropy bytes
 */
const generateEntropy = (wordCount) => {
  if (wordCount !== 12 && wordCount !== 24) {
    throw new Error('Word count must be 12 or 24')
  }
  // 12 words = 128 bits, 24 words = 256 bits
  const entropyLength = wordCount === 12 ? 16 : 32
  const entropyBuffer = crypto.randomBytes(entropyLength)
  // Create a new Uint8Array and copy bytes explicitly for @scure/bip39 compatibility
  const entropy = new Uint8Array(entropyLength)
  entropy.set(entropyBuffer)
  // Zero out the original buffer
  memzero(entropyBuffer)
  return entropy
}

/**
 * Encrypt seed and entropy with a new encryption key.
 * All Buffer inputs are zeroed before returning.
 * @param {Uint8Array | Buffer} seed - Seed bytes to encrypt
 * @param {Uint8Array | Buffer} entropy - Entropy bytes to encrypt
 * @returns {WdkEntropyResult} Object containing encryptionKey, encryptedSeedBuffer, and encryptedEntropyBuffer.
 *   All three returned values are strings and cannot be zeroed — treat them
 *   as residual heap data once no longer needed.
 */
const encryptSecrets = (seed, entropy) => {
  const encryptionKeyBuffer = crypto.randomBytes(32)

  const seedBuffer = Buffer.isBuffer(seed) ? seed : Buffer.from(seed)
  const entropyBuffer = Buffer.isBuffer(entropy) ? entropy : Buffer.from(entropy)

  const encryptedSeedBuffer = encrypt(seedBuffer, encryptionKeyBuffer)
  const encryptedEntropyBuffer = encrypt(entropyBuffer, encryptionKeyBuffer)

  memzero(seedBuffer)
  memzero(entropyBuffer)
  if (seed !== seedBuffer) memzero(seed)
  if (entropy !== entropyBuffer) memzero(entropy)

  const encryptionKey = encryptionKeyBuffer.toString('base64')
  memzero(encryptionKeyBuffer)

  return {
    encryptionKey,
    encryptedSeedBuffer,
    encryptedEntropyBuffer
  }
}

module.exports = {
  memzero,
  generateEncryptionKey,
  encrypt,
  decrypt,
  generateEntropy,
  encryptSecrets
}
