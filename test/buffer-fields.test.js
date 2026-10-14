#!/usr/bin/env node

/**
 * Unit tests for src/utils/buffer-fields.js
 *
 * Run with: node --test test/buffer-fields.test.js
 */

// Load test setup first to mock bare-crypto (buffer-fields.js pulls in crypto.js)
require('./setup.js')

const { test, describe } = require('node:test')
const assert = require('node:assert')

const { decodeBufferFields, encodeBufferFields } = require('../src/utils/buffer-fields')

describe('decodeBufferFields', () => {
  test('decodes known fields from base64 strings into Buffers', () => {
    const plaintext = Buffer.from('secret')
    const obj = { encryptionKey: plaintext.toString('base64'), other: 'untouched' }

    decodeBufferFields(obj)

    assert.ok(Buffer.isBuffer(obj.encryptionKey))
    assert.deepStrictEqual(obj.encryptionKey, plaintext)
    assert.strictEqual(obj.other, 'untouched')
  })

  test('leaves non-string/unknown fields alone', () => {
    const obj = { encryptionKey: Buffer.from('already a buffer'), unrelated: 42 }
    decodeBufferFields(obj)
    assert.ok(Buffer.isBuffer(obj.encryptionKey))
    assert.strictEqual(obj.unrelated, 42)
  })

  test('does nothing on null/non-object input', () => {
    assert.strictEqual(decodeBufferFields(null), null)
    assert.strictEqual(decodeBufferFields(undefined), undefined)
  })
})

describe('encodeBufferFields', () => {
  test('encodes known Buffer fields into base64 strings', () => {
    const plaintext = Buffer.from('secret')
    const obj = { encryptedSeedBuffer: Buffer.from(plaintext), other: 'untouched' }

    encodeBufferFields(obj)

    assert.strictEqual(obj.encryptedSeedBuffer, plaintext.toString('base64'))
    assert.strictEqual(obj.other, 'untouched')
  })

  test('zeroes the original Buffer once it has been encoded', () => {
    const original = Buffer.from('secret')
    const buffer = Buffer.from(original)
    const obj = { encryptedEntropyBuffer: buffer }

    encodeBufferFields(obj)

    // The field now holds the base64 string; the original Buffer object
    // (still referenced here) must have had its bytes wiped.
    assert.deepStrictEqual(buffer, Buffer.alloc(original.length))
  })

  test('leaves non-Buffer/unknown fields alone', () => {
    const obj = { encryptionKey: 'already a string', unrelated: 42 }
    encodeBufferFields(obj)
    assert.strictEqual(obj.encryptionKey, 'already a string')
    assert.strictEqual(obj.unrelated, 42)
  })

  test('does nothing on null/non-object input', () => {
    assert.strictEqual(encodeBufferFields(null), null)
    assert.strictEqual(encodeBufferFields(undefined), undefined)
  })
})
