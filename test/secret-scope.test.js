#!/usr/bin/env node

/**
 * Unit tests for src/utils/secret-scope.js
 *
 * Run with: node --test test/secret-scope.test.js
 */

// Load test setup first to mock bare-crypto (secret-scope.js pulls in crypto.js)
require('./setup.js')

const { test, describe } = require('node:test')
const assert = require('node:assert')

const { createSecretScope } = require('../src/utils/secret-scope')

describe('createSecretScope', () => {
  test('close() zeroes every tracked buffer', () => {
    const scope = createSecretScope()
    const a = scope.track(Buffer.from([1, 2, 3]))
    const b = scope.track(Buffer.from([4, 5, 6]))

    scope.close()

    assert.deepStrictEqual(a, Buffer.from([0, 0, 0]))
    assert.deepStrictEqual(b, Buffer.from([0, 0, 0]))
  })

  test('release() exempts a buffer from close()', () => {
    const scope = createSecretScope()
    const kept = scope.track(Buffer.from([1, 2, 3]))
    const zeroed = scope.track(Buffer.from([4, 5, 6]))

    scope.release(kept)
    scope.close()

    assert.deepStrictEqual(kept, Buffer.from([1, 2, 3]))
    assert.deepStrictEqual(zeroed, Buffer.from([0, 0, 0]))
  })

  test('close() zeroes buffers tracked before a throw, when used with try/finally', () => {
    const scope = createSecretScope()
    let leaked

    assert.throws(() => {
      try {
        leaked = scope.track(Buffer.from([9, 9, 9]))
        throw new Error('boom')
      } finally {
        scope.close()
      }
    }, /boom/)

    assert.deepStrictEqual(leaked, Buffer.from([0, 0, 0]))
  })

  test('close() is idempotent and safe to call more than once', () => {
    const scope = createSecretScope()
    const buf = scope.track(Buffer.from([1, 2, 3]))

    scope.close()
    assert.doesNotThrow(() => scope.close())
    assert.deepStrictEqual(buf, Buffer.from([0, 0, 0]))
  })

  test('track() ignores falsy values', () => {
    const scope = createSecretScope()
    assert.doesNotThrow(() => {
      scope.track(null)
      scope.track(undefined)
      scope.close()
    })
  })

  test('track() and release() return the same buffer for inline use', () => {
    const scope = createSecretScope()
    const buf = Buffer.from([1, 2, 3])
    assert.strictEqual(scope.track(buf), buf)
    assert.strictEqual(scope.release(buf), buf)
  })

  test('release() on an untracked buffer is a no-op', () => {
    const scope = createSecretScope()
    const buf = Buffer.from([1, 2, 3])
    assert.doesNotThrow(() => scope.release(buf))
  })

  test('two scopes track independently', () => {
    const scopeA = createSecretScope()
    const scopeB = createSecretScope()
    const bufA = scopeA.track(Buffer.from([1, 2, 3]))
    const bufB = scopeB.track(Buffer.from([4, 5, 6]))

    scopeA.close()

    assert.deepStrictEqual(bufA, Buffer.from([0, 0, 0]))
    assert.deepStrictEqual(bufB, Buffer.from([4, 5, 6]))
  })
})
