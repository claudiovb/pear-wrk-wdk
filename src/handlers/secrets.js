const { entropyToMnemonic, mnemonicToSeedSync, mnemonicToEntropy } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const { validateRequest, validateBuffer, validateMnemonic, validateWordCount } = require('../utils/validation')
const { decrypt, generateEntropy, encryptSecrets } = require('../utils/crypto')
const { createSecretScope } = require('../utils/secret-scope')

/** @typedef {import('../../types/rpc').WdkGenerateEntropyParams} WdkGenerateEntropyParams */
/** @typedef {import('../../types/rpc').WdkGetMnemonicParams} WdkGetMnemonicParams */
/** @typedef {import('../../types/rpc').WdkEntropyResult} WdkEntropyResult */

/**
 * @param {WdkGenerateEntropyParams} request
 * @returns {Promise<WdkEntropyResult>} Return buffers, not zeroed by this
 *   handler. JSON-RPC zeroes them after base64-encoding (see
 *   buffer-fields.js); HRPC hands them back live with no interception
 *   point in this repo, so zeroing them is that caller's responsibility.
 */
async function generateEntropyAndEncryptHandler (request) {
  const { wordCount } = request
  const scope = createSecretScope()

  try {
    validateRequest(request, () => validateWordCount(wordCount, 'wordCount'))

    const entropy = scope.track(generateEntropy(wordCount))

    // Known, accepted gap: JS strings are immutable, so mnemonic can't be
    // zeroed and stays in the V8 heap until GC reclaims it.
    const mnemonic = entropyToMnemonic(entropy, wordlist)

    const seedBuffer = scope.track(mnemonicToSeedSync(mnemonic))
    const entropyBuffer = scope.track(Buffer.from(entropy))

    const { encryptionKey, encryptedSeedBuffer, encryptedEntropyBuffer } =
      encryptSecrets(seedBuffer, entropyBuffer)

    return {
      encryptionKey,
      encryptedSeedBuffer,
      encryptedEntropyBuffer
    }
  } finally {
    scope.close()
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
  const scope = createSecretScope()

  try {
    scope.track(encryptedEntropy)
    scope.track(encryptionKey)

    validateRequest(request, () => {
      validateBuffer(encryptedEntropy, 'encryptedEntropy')
      validateBuffer(encryptionKey, 'encryptionKey')
    })

    const entropyBuffer = scope.track(decrypt(encryptedEntropy, encryptionKey))

    // For @scure/bip39 compatibility
    const entropy = scope.track(new Uint8Array(entropyBuffer.length))
    entropy.set(entropyBuffer)

    const mnemonic = entropyToMnemonic(entropy, wordlist)

    return { mnemonic }
  } finally {
    scope.close()
  }
}

/**
 * Takes a BIP39 mnemonic phrase and derives both the seed (used by WDK)
 * and entropy (original random bytes), then encrypts both for secure storage.
 *
 * @param {object} request - The RPC request object
 * @param {string} request.mnemonic - BIP39 mnemonic phrase (12 or 24 words).
 *   As a JS string, it cannot be zeroed and remains in the V8 heap after this call.
 * @returns {Promise<WdkEntropyResult>} Not zeroed by this handler — same
 *   transport-dependent handling as generateEntropyAndEncryptHandler:
 *   zeroed for JSON-RPC (buffer-fields.js), left live for HRPC.
 */
async function getSeedAndEntropyFromMnemonicHandler (request) {
  const { mnemonic } = request
  const scope = createSecretScope()

  try {
    validateRequest(request, () => validateMnemonic(mnemonic, 'mnemonic'))

    const seed = scope.track(mnemonicToSeedSync(mnemonic))
    const entropy = scope.track(mnemonicToEntropy(mnemonic, wordlist))

    return encryptSecrets(seed, entropy)
  } finally {
    scope.close()
  }
}

module.exports = {
  getMnemonicFromEntropyHandler,
  generateEntropyAndEncryptHandler,
  getSeedAndEntropyFromMnemonicHandler
}
