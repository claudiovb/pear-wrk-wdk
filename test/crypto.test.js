#!/usr/bin/env node

/**
 * Unit tests for src/utils/crypto.js
 *
 * Run with: node --test test/crypto.test.js
 */

// Load test setup first to mock bare-crypto
require('./setup.js')

const { test, describe } = require('node:test')
const assert = require('node:assert')

const {
  memzero,
  generateEncryptionKey,
  encrypt,
  decrypt,
  generateEntropy,
  encryptSecrets
} = require('../src/utils/crypto')

describe('crypto utils', () => {
  describe('memzero', () => {
    test('zeroes a Buffer in place', () => {
      const buf = Buffer.from([1, 2, 3, 4])
      memzero(buf)
      assert.deepStrictEqual(buf, Buffer.from([0, 0, 0, 0]))
    })

    test('zeroes a Uint8Array in place', () => {
      const arr = new Uint8Array([1, 2, 3, 4])
      memzero(arr)
      assert.deepStrictEqual(arr, new Uint8Array([0, 0, 0, 0]))
    })

    test('zeroes an ArrayBuffer in place', () => {
      const ab = new ArrayBuffer(4)
      new Uint8Array(ab).set([1, 2, 3, 4])
      memzero(ab)
      assert.deepStrictEqual(new Uint8Array(ab), new Uint8Array([0, 0, 0, 0]))
    })

    test('zeroes a TypedArray view without touching the rest of the backing buffer', () => {
      const buf = Buffer.from([1, 2, 3, 4, 5, 6])
      const view = buf.subarray(2, 4)
      memzero(view)
      assert.deepStrictEqual(buf, Buffer.from([1, 2, 0, 0, 5, 6]))
    })

    test('does nothing on null/undefined', () => {
      assert.doesNotThrow(() => memzero(null))
      assert.doesNotThrow(() => memzero(undefined))
    })

    test('does nothing (and does not throw) on an unrelated value', () => {
      assert.doesNotThrow(() => memzero({}))
      assert.doesNotThrow(() => memzero('not a buffer'))
      assert.doesNotThrow(() => memzero(42))
    })
  })

  describe('generateEncryptionKey', () => {
    test('returns a 32-byte Buffer', () => {
      const key = generateEncryptionKey()
      assert.ok(Buffer.isBuffer(key))
      assert.strictEqual(key.length, 32)
    })

    test('returns a different key on each call', () => {
      const key1 = generateEncryptionKey()
      const key2 = generateEncryptionKey()
      assert.notDeepStrictEqual(key1, key2)
    })
  })

  describe('encrypt / decrypt', () => {
    test('round-trips Buffer data through encrypt then decrypt', () => {
      const key = generateEncryptionKey()
      const plaintext = Buffer.from('hello wallet seed', 'utf8')
      const encrypted = encrypt(Buffer.from(plaintext), key)
      const decrypted = decrypt(encrypted, key)
      assert.deepStrictEqual(decrypted, plaintext)
    })

    test('round-trips Uint8Array data the same as Buffer data', () => {
      const key = generateEncryptionKey()
      const plaintext = new Uint8Array([10, 20, 30, 40, 50])
      const encrypted = encrypt(plaintext, key)
      const decrypted = decrypt(encrypted, key)
      assert.deepStrictEqual(decrypted, Buffer.from(plaintext))
    })

    test('returns a Buffer of length iv(12) + plaintext.length + tag(16)', () => {
      const key = generateEncryptionKey()
      const plaintext = Buffer.from([1, 2, 3, 4, 5])
      const encrypted = encrypt(plaintext, key)
      assert.ok(Buffer.isBuffer(encrypted))
      assert.strictEqual(encrypted.length, 12 + plaintext.length + 16)
    })

    test('produces a different ciphertext for the same plaintext/key on each call (random IV)', () => {
      const key = generateEncryptionKey()
      const plaintext = Buffer.from('same input every time')
      const encrypted1 = encrypt(Buffer.from(plaintext), key)
      const encrypted2 = encrypt(Buffer.from(plaintext), key)
      assert.notDeepStrictEqual(encrypted1, encrypted2)
    })

    test('decrypt throws when the ciphertext/auth tag has been tampered with', () => {
      const key = generateEncryptionKey()
      const plaintext = Buffer.from('do not tamper with me')
      const encrypted = encrypt(plaintext, key)
      encrypted[encrypted.length - 1] ^= 0xff // flip a bit in the auth tag
      assert.throws(() => decrypt(encrypted, key))
    })

    test('decrypt throws when given the wrong key', () => {
      const key = generateEncryptionKey()
      const wrongKey = generateEncryptionKey()
      const plaintext = Buffer.from('secret')
      const encrypted = encrypt(plaintext, key)
      assert.throws(() => decrypt(encrypted, wrongKey))
    })

    test('does not zero a Buffer `data` argument passed directly', () => {
      const key = generateEncryptionKey()
      const plaintext = Buffer.from([9, 8, 7, 6])
      const original = Buffer.from(plaintext)
      encrypt(plaintext, key)
      assert.deepStrictEqual(plaintext, original)
    })

    test('does not zero the `key` argument to encrypt', () => {
      const key = generateEncryptionKey()
      const original = Buffer.from(key)
      const plaintext = Buffer.from('data')
      encrypt(plaintext, key)
      assert.deepStrictEqual(key, original)
    })

    test('does not zero the caller-owned encryptedBuffer or key passed to decrypt', () => {
      const key = generateEncryptionKey()
      const originalKey = Buffer.from(key)
      const plaintext = Buffer.from('data')
      const encrypted = encrypt(plaintext, key)
      const originalEncrypted = Buffer.from(encrypted)
      decrypt(encrypted, key)
      assert.deepStrictEqual(encrypted, originalEncrypted)
      assert.deepStrictEqual(key, originalKey)
    })
  })

  describe('generateEntropy', () => {
    test('returns 16 bytes of entropy for 12 words', () => {
      const entropy = generateEntropy(12)
      assert.ok(entropy instanceof Uint8Array)
      assert.strictEqual(entropy.length, 16)
    })

    test('returns 32 bytes of entropy for 24 words', () => {
      const entropy = generateEntropy(24)
      assert.strictEqual(entropy.length, 32)
    })

    test('throws for an unsupported word count', () => {
      assert.throws(() => generateEntropy(15), /Word count must be 12 or 24/)
      assert.throws(() => generateEntropy(0))
      assert.throws(() => generateEntropy(undefined))
    })

    test('returns different entropy on each call', () => {
      const entropy1 = generateEntropy(12)
      const entropy2 = generateEntropy(12)
      assert.notDeepStrictEqual(entropy1, entropy2)
    })
  })

  describe('encryptSecrets', () => {
    test('returns encryptionKey, encryptedSeedBuffer, encryptedEntropyBuffer as Buffers', () => {
      const seed = Buffer.from('a'.repeat(64))
      const entropy = generateEntropy(12)
      const result = encryptSecrets(seed, entropy)
      assert.ok(Buffer.isBuffer(result.encryptionKey))
      assert.ok(Buffer.isBuffer(result.encryptedSeedBuffer))
      assert.ok(Buffer.isBuffer(result.encryptedEntropyBuffer))
    })

    test('the returned ciphertexts decrypt back to the original seed/entropy', () => {
      const seed = Buffer.from('b'.repeat(64))
      const entropy = generateEntropy(24)
      const originalSeed = Buffer.from(seed)
      const originalEntropy = Buffer.from(entropy)
      const result = encryptSecrets(seed, entropy)

      const decryptedSeed = decrypt(result.encryptedSeedBuffer, result.encryptionKey)
      const decryptedEntropy = decrypt(result.encryptedEntropyBuffer, result.encryptionKey)

      assert.deepStrictEqual(decryptedSeed, originalSeed)
      assert.deepStrictEqual(decryptedEntropy, originalEntropy)
    })

    test('produces a different encryptionKey on each call', () => {
      const seed = Buffer.from('c'.repeat(64))
      const entropy = generateEntropy(12)
      const result1 = encryptSecrets(Buffer.from(seed), Buffer.from(entropy))
      const result2 = encryptSecrets(Buffer.from(seed), Buffer.from(entropy))
      assert.notDeepStrictEqual(result1.encryptionKey, result2.encryptionKey)
    })

    test('does not zero seed/entropy when passed in as Buffers directly', () => {
      const seed = Buffer.from('d'.repeat(64))
      const entropy = Buffer.from(generateEntropy(12))
      const originalSeed = Buffer.from(seed)
      const originalEntropy = Buffer.from(entropy)

      encryptSecrets(seed, entropy)

      assert.deepStrictEqual(seed, originalSeed)
      assert.deepStrictEqual(entropy, originalEntropy)
    })
  })
})
