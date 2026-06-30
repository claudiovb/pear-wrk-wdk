const { entropyToMnemonic, mnemonicToSeedSync, mnemonicToEntropy } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const { validateRequest, validateBase64, validateMnemonic, validateWordCount } = require('../utils/validation')
const { memzero, decrypt, generateEntropy, encryptSecrets } = require('../utils/crypto')

/** @typedef {import('../../types/rpc').WdkGenerateEntropyParams} WdkGenerateEntropyParams */
/** @typedef {import('../../types/rpc').WdkGetMnemonicParams} WdkGetMnemonicParams */
/** @typedef {import('../../types/rpc').WdkEntropyResult} WdkEntropyResult */

/**
 * @param {WdkGenerateEntropyParams} request
 * @returns {Promise<WdkEntropyResult>} All three returned values are strings and
 *   cannot be zeroed — see encryptSecrets. The intermediate mnemonic string
 *   generated internally also cannot be zeroed.
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
    validateBase64(encryptedEntropy, 'encryptedEntropy')
    validateBase64(encryptionKey, 'encryptionKey')
  })

  const entropyBuffer = decrypt(encryptedEntropy, encryptionKey)

  // For @scure/bip39 compatibility
  const entropy = new Uint8Array(entropyBuffer.length)
  entropy.set(entropyBuffer)

  const mnemonic = entropyToMnemonic(entropy, wordlist)

  // Important: Zero out sensitive buffers
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
 * @returns {Promise<WdkEntropyResult>} Encrypted seed and entropy with encryption key.
 *   All three returned values are strings and cannot be zeroed — see encryptSecrets.
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

  return encryptSecrets(seed, entropy)
}

module.exports = {
  getMnemonicFromEntropyHandler,
  generateEntropyAndEncryptHandler,
  getSeedAndEntropyFromMnemonicHandler
}
