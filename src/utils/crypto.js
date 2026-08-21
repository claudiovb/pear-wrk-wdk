// External dependencies
const crypto = require('bare-crypto')

/** @typedef {import('../../types/rpc').WdkEntropyResult} WdkEntropyResult */

/**
 * Buffer Type Strategy:
 * - Functions accept both Buffer and Uint8Array as input for flexibility
 * - Return values are always Buffers, never base64 strings — secret
 *   material crosses the HRPC boundary as native buffer-typed fields (see
 *   schema.json), so there is no wire-format reason to encode into
 *   strings here
 * - Uint8Array is used for entropy operations (required by @scure/bip39)
 * - Ownership: each function's doc comment states exactly which
 *   parameters/return values it zeroes itself vs. leaves for the caller —
 *   a function only zeroes what it allocates itself, never an input
 *   Buffer it was merely handed (the caller may still need it, or may
 *   need to reuse it, e.g. a key across multiple encrypt() calls)
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
 * @returns {Buffer} Encryption key. Caller is responsible for zeroing it
 *   once no longer needed.
 */
const generateEncryptionKey = () => {
  return crypto.randomBytes(32)
}

/**
 * Encrypt data using AES-256-GCM
 * @param {Uint8Array | Buffer} data - Data to encrypt. Not zeroed by this
 *   function unless an internal copy had to be made (Uint8Array input) —
 *   if the caller passes a Buffer directly, that Buffer is left untouched
 *   and the caller is responsible for zeroing it once no longer needed.
 * @param {Buffer} key - Encryption key. Not zeroed — caller owns it and
 *   may need to reuse it across multiple encrypt() calls.
 * @returns {Buffer} IV + encrypted data + auth tag, concatenated. Caller is
 *   responsible for zeroing it once no longer needed.
 */
const encrypt = (data, key) => {
  const iv = crypto.randomBytes(12) // 96-bit IV for GCM

  // Convert data to Buffer if needed (only zero the internal copy)
  const dataIsCopy = !Buffer.isBuffer(data)
  const dataBuffer = dataIsCopy ? Buffer.from(data) : data

  let encrypted, authTag, result
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()])
    authTag = cipher.getAuthTag()

    // Combine IV + encrypted data + auth tag
    result = Buffer.concat([iv, encrypted, authTag])
    return result
  } finally {
    // Zero out sensitive buffers; caller is responsible for zeroing the
    // key, the data Buffer they own (if they passed one directly), and
    // the returned result, once no longer needed
    memzero(iv)
    memzero(encrypted)
    memzero(authTag)
    if (dataIsCopy) memzero(dataBuffer)
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {Buffer} encryptedBuffer - IV + encrypted data + auth tag,
 *   concatenated. Not zeroed by this function — it arrives as the
 *   caller's own Buffer (no internal copy is made here), so the caller
 *   is responsible for zeroing it once no longer needed.
 * @param {Buffer} key - Encryption key. Not zeroed — caller owns it.
 * @returns {Buffer} Decrypted data. Caller is responsible for zeroing it
 *   once no longer needed.
 */
const decrypt = (encryptedBuffer, key) => {
  // Extract IV (12 bytes), encrypted data, and auth tag (16 bytes) — views
  // into the caller's own encryptedBuffer, not our allocations.
  const iv = encryptedBuffer.subarray(0, 12)
  const authTag = encryptedBuffer.subarray(encryptedBuffer.length - 16)
  const encrypted = encryptedBuffer.subarray(12, encryptedBuffer.length - 16)

  let decrypted, final
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    decrypted = decipher.update(encrypted)
    final = decipher.final()
    return Buffer.concat([decrypted, final])
  } finally {
    memzero(decrypted)
    memzero(final)
  }
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
 * @param {Uint8Array | Buffer} seed - Seed bytes to encrypt. Not zeroed by
 *   this function unless an internal copy had to be made (Uint8Array
 *   input) — if the caller passes a Buffer directly, that Buffer is left
 *   untouched and the caller is responsible for zeroing it once no longer
 *   needed.
 * @param {Uint8Array | Buffer} entropy - Entropy bytes to encrypt. Same
 *   caller-ownership rule as seed.
 * @returns {WdkEntropyResult} Object containing encryptionKey,
 *   encryptedSeedBuffer, and encryptedEntropyBuffer — all Buffers. Caller
 *   is responsible for zeroing them once no longer needed.
 */
const encryptSecrets = (seed, entropy) => {
  const encryptionKeyBuffer = crypto.randomBytes(32)

  const seedIsCopy = !Buffer.isBuffer(seed)
  const entropyIsCopy = !Buffer.isBuffer(entropy)
  const seedBuffer = seedIsCopy ? Buffer.from(seed) : seed
  const entropyBuffer = entropyIsCopy ? Buffer.from(entropy) : entropy

  // Wrapped so seedBuffer/entropyBuffer copies still get zeroed even if
  // the second encrypt() call throws after the first one succeeded.
  try {
    const encryptedSeedBuffer = encrypt(seedBuffer, encryptionKeyBuffer)
    const encryptedEntropyBuffer = encrypt(entropyBuffer, encryptionKeyBuffer)

    return {
      encryptionKey: encryptionKeyBuffer,
      encryptedSeedBuffer,
      encryptedEntropyBuffer
    }
  } finally {
    if (seedIsCopy) memzero(seedBuffer)
    if (entropyIsCopy) memzero(entropyBuffer)
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
