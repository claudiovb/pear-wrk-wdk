/**
 * Names of the fields that carry seed or encryption material. A value stored
 * under one of them is never written to the console and never copied into an
 * error returned to the host.
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

module.exports = SECRET_KEYS
