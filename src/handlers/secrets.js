const { entropyToMnemonic, mnemonicToSeedSync, mnemonicToEntropy } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const { validateRequest, validateBuffer, validateMnemonic, validateWordCount } = require('../utils/validation')
const { memzero, decrypt, generateEntropy, encryptSecrets } = require('../utils/crypto')

/** @typedef {import('../../types/rpc').WdkGenerateEntropyParams} WdkGenerateEntropyParams */
/** @typedef {import('../../types/rpc').WdkGetMnemonicParams} WdkGetMnemonicParams */
/** @typedef {import('../../types/rpc').WdkEntropyResult} WdkEntropyResult */

/**
 * @param {WdkGenerateEntropyParams} request
 * @returns {Promise<WdkEntropyResult>} encryptionKey, encryptedSeedBuffer,
 *   and encryptedEntropyBuffer are all Buffers — see encryptSecrets. Not
 *   yet zeroed after this handler returns (no plumbing exists yet to zero
 *   them once the RPC response has been sent — a known, deferred gap).
 *   The intermediate mnemonic string generated internally still cannot be
 *   zeroed (JS strings are immutable).
 */
async function generateEntropyAndEncryptHandler (request) {
  const { wordCount } = request

  validateRequest(request, () => validateWordCount(wordCount, 'wordCount'))

  const entropy = generateEntropy(wordCount)

  const mnemonic = entropyToMnemonic(entropy, wordlist)

  const seedBuffer = mnemonicToSeedSync(mnemonic)
  const entropyBuffer = Buffer.from(entropy)

  const { encryptionKey, encryptedSeedBuffer, encryptedEntropyBuffer } =
    encryptSecrets(seedBuffer, entropyBuffer)

  // encryptSecrets() only zeroes an internal copy it made itself —
  // seedBuffer and entropyBuffer are ours, so we're responsible for
  // zeroing them here.
  memzero(seedBuffer)
  memzero(entropyBuffer)
  memzero(entropy)

  return {
    encryptionKey,
    encryptedSeedBuffer,
    encryptedEntropyBuffer
  }
}

/**
 * @param {WdkGetMnemonicParams} request
 * @returns {Promise<{ mnemonic: string }>} The mnemonic is a string and cannot
 *   be zeroed — callers should discard the reference as soon as it has been
 *   displayed to the user.
 */
async function getMnemonicFromEntropyHandler (request) {
  const { encryptedEntropy, encryptionKey } = request

  validateRequest(request, () => {
    validateBuffer(encryptedEntropy, 'encryptedEntropy')
    validateBuffer(encryptionKey, 'encryptionKey')
  })

  const entropyBuffer = decrypt(encryptedEntropy, encryptionKey)

  // For @scure/bip39 compatibility
  const entropy = new Uint8Array(entropyBuffer.length)
  entropy.set(entropyBuffer)

  const mnemonic = entropyToMnemonic(entropy, wordlist)

  // Important: Zero out sensitive buffers. decrypt() doesn't touch
  // encryptedEntropy/encryptionKey — they're the raw request buffers we
  // own as the sole consumer of this inbound RPC call, so we zero them
  // here once no longer needed.
  memzero(encryptedEntropy)
  memzero(encryptionKey)
  memzero(entropyBuffer)
  memzero(entropy)

  return { mnemonic }
}

/**
 * Takes a BIP39 mnemonic phrase and derives both the seed (used by WDK)
 * and entropy (original random bytes), then encrypts both for secure storage.
 *
 * @param {object} request - The RPC request object
 * @param {string} request.mnemonic - BIP39 mnemonic phrase (12 or 24 words).
 *   As a JS string, it cannot be zeroed and remains in the V8 heap after this call.
 * @returns {Promise<WdkEntropyResult>} Encrypted seed and entropy with
 *   encryption key — all three are Buffers now. Not yet zeroed after this
 *   handler returns (same deferred gap as generateEntropyAndEncryptHandler
 *   — no plumbing exists yet to zero them once the RPC response is sent).
 */
async function getSeedAndEntropyFromMnemonicHandler (request) {
  const { mnemonic } = request

  validateRequest(request, () => validateMnemonic(mnemonic, 'mnemonic'))

  const seed = mnemonicToSeedSync(mnemonic)
  let entropy
  try {
    entropy = mnemonicToEntropy(mnemonic, wordlist)
  } catch (err) {
    memzero(seed)
    throw err
  }

  const result = encryptSecrets(seed, entropy)

  // encryptSecrets() only zeroes an internal copy it made itself — seed
  // and entropy are ours, so we're responsible for zeroing them here.
  memzero(seed)
  memzero(entropy)

  return result
}

module.exports = {
  getMnemonicFromEntropyHandler,
  generateEntropyAndEncryptHandler,
  getSeedAndEntropyFromMnemonicHandler
}
