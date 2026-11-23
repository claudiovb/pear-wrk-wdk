#!/usr/bin/env node

/**
 * Unit tests for src/exceptions/rpc-exception.js
 *
 * Run with: node --test test/rpc-exception.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')

const { ExternalError, callExternal, createStructuredError, toRpcError } = require('../src/exceptions/rpc-exception')

function createErrorWithCode (message, code) {
  return Object.assign(new Error(message), { code })
}

describe('createStructuredError', () => {
  test('should report the code, the message and the name of an error', () => {
    const error = createErrorWithCode('Init must be an object', 'BAD_REQUEST')

    const structuredError = createStructuredError(error)

    assert.deepStrictEqual(structuredError, {
      code: 'BAD_REQUEST',
      message: 'Init must be an object',
      name: 'Error'
    })
  })

  test('should report the name of an error class', () => {
    class TransactionError extends Error {
      constructor (message) {
        super(message)
        this.name = 'TransactionError'
      }
    }
    const error = Object.assign(new TransactionError('No unspent outputs available.'), { code: 'BAD_REQUEST' })

    const structuredError = createStructuredError(error)

    assert.deepStrictEqual(structuredError, {
      code: 'BAD_REQUEST',
      message: 'No unspent outputs available.',
      name: 'TransactionError'
    })
  })

  test('should report the code given by the caller when the error has none', () => {
    const error = new Error('Something failed')

    const structuredError = createStructuredError(error, 'METHOD_NOT_ALLOWED')

    assert.deepStrictEqual(structuredError, {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Something failed',
      name: 'Error'
    })
  })

  test('should report INTERNAL_ERROR when the error carries no code and the caller gives none', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'bitcoin')")

    const structuredError = createStructuredError(error)

    assert.deepStrictEqual(structuredError, {
      code: 'INTERNAL_ERROR',
      message: "Cannot read properties of undefined (reading 'bitcoin')",
      name: 'TypeError'
    })
  })

  test('should not report the code of a library as the code, and keep it in the details', () => {
    const error = Object.assign(new TypeError('Invalid authentication tag length: 7'), { code: 'ERR_CRYPTO_INVALID_AUTH_TAG' })

    const structuredError = createStructuredError(error)

    assert.deepStrictEqual(structuredError, {
      code: 'INTERNAL_ERROR',
      message: 'Invalid authentication tag length: 7',
      name: 'TypeError',
      details: { code: 'ERR_CRYPTO_INVALID_AUTH_TAG' }
    })
  })

  test('should report the code of an external error and describe the value it wraps', () => {
    const thrown = Object.assign(new Error('insufficient funds for intrinsic transaction cost'), { code: 'INSUFFICIENT_FUNDS' })
    const error = new ExternalError('WALLET_ERROR', thrown)

    const structuredError = createStructuredError(error)

    assert.deepStrictEqual(structuredError, {
      code: 'WALLET_ERROR',
      message: 'insufficient funds for intrinsic transaction cost',
      name: 'Error',
      details: { code: 'INSUFFICIENT_FUNDS' }
    })
  })

  test('should describe a thrown null', () => {
    const structuredError = createStructuredError(null)

    assert.deepStrictEqual(structuredError, {
      code: 'INTERNAL_ERROR',
      message: 'null',
      name: 'Error'
    })
  })

  test('should describe a thrown value that is not an error', () => {
    const structuredError = createStructuredError('Something failed', 'BAD_REQUEST')

    assert.deepStrictEqual(structuredError, {
      code: 'BAD_REQUEST',
      message: 'Something failed',
      name: 'Error'
    })
  })

  describe('details', () => {
    test('should copy the string, number and boolean properties of an error', () => {
      const error = Object.assign(createErrorWithCode('User operation rejected', 'BAD_REQUEST'), {
        reason: 'INSUFFICIENT_BALANCE',
        aaCode: 'AA33',
        httpStatus: 429,
        retryable: false
      })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError, {
        code: 'BAD_REQUEST',
        message: 'User operation rejected',
        name: 'Error',
        details: {
          reason: 'INSUFFICIENT_BALANCE',
          aaCode: 'AA33',
          httpStatus: 429,
          retryable: false
        }
      })
    })

    test('should not copy objects, arrays, functions and numbers that are not finite', () => {
      const error = Object.assign(createErrorWithCode('Request failed', 'BAD_REQUEST'), {
        request: { body: '{"password":"hunter2"}' },
        headers: ['authorization: Bearer token'],
        retry: () => {},
        elapsed: NaN,
        httpStatus: 500
      })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError, {
        code: 'BAD_REQUEST',
        message: 'Request failed',
        name: 'Error',
        details: { httpStatus: 500 }
      })
    })

    test('should not copy the fields that carry seed or encryption material', () => {
      const error = Object.assign(createErrorWithCode('Wallet failed', 'BAD_REQUEST'), {
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        seed: '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1',
        encryptionKey: 'c2VjcmV0',
        network: 'bitcoin'
      })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError, {
        code: 'BAD_REQUEST',
        message: 'Wallet failed',
        name: 'Error',
        details: { network: 'bitcoin' }
      })
    })

    test('should not copy what the other fields already report', () => {
      const error = createErrorWithCode('Wallet failed', 'BAD_REQUEST')
      Object.defineProperties(error, {
        name: { value: 'WalletError', enumerable: true },
        message: { value: 'Wallet failed', enumerable: true },
        stack: { value: 'WalletError: Wallet failed\n    at wallet.js:1:1', enumerable: true },
        cause: { value: 'timeout', enumerable: true }
      })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError, {
        code: 'BAD_REQUEST',
        message: 'Wallet failed',
        name: 'WalletError',
        causes: [{ name: 'Error', message: 'timeout' }]
      })
    })

    test('should cut a string property at 256 characters', () => {
      const error = Object.assign(createErrorWithCode('Request failed', 'BAD_REQUEST'), {
        responseText: 'a'.repeat(300)
      })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError.details, { responseText: 'a'.repeat(256) })
    })

    test('should copy at most 16 properties', () => {
      const error = createErrorWithCode('Request failed', 'BAD_REQUEST')
      for (let i = 1; i <= 20; i++) error[`property${i}`] = i

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(Object.keys(structuredError.details), [
        'property1', 'property2', 'property3', 'property4',
        'property5', 'property6', 'property7', 'property8',
        'property9', 'property10', 'property11', 'property12',
        'property13', 'property14', 'property15', 'property16'
      ])
    })
  })

  describe('causes', () => {
    test('should describe the chain of causes, outermost first', () => {
      const transportError = Object.assign(new Error('429 Too Many Requests'), { name: 'HttpError', httpStatus: 429 })
      const paymasterError = Object.assign(new Error('AA33 reverted', { cause: transportError }), { aaCode: 'AA33' })
      const error = Object.assign(new Error('Paymaster rejected the user operation', { cause: paymasterError }), { code: 'BAD_REQUEST' })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError, {
        code: 'BAD_REQUEST',
        message: 'Paymaster rejected the user operation',
        name: 'Error',
        causes: [
          { name: 'Error', message: 'AA33 reverted', details: { aaCode: 'AA33' } },
          { name: 'HttpError', message: '429 Too Many Requests', details: { httpStatus: 429 } }
        ]
      })
    })

    test('should keep the code a cause carries in its details', () => {
      const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8545'), { code: 'ECONNREFUSED', errno: -61 })
      const error = Object.assign(new Error('Provider unreachable', { cause }), { code: 'BAD_REQUEST' })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError.causes, [
        { name: 'Error', message: 'connect ECONNREFUSED 127.0.0.1:8545', details: { code: 'ECONNREFUSED', errno: -61 } }
      ])
    })

    test('should describe at most 8 causes', () => {
      let error = new Error('cause 9')
      for (let i = 8; i >= 1; i--) error = new Error(`cause ${i}`, { cause: error })
      error = Object.assign(new Error('Wallet failed', { cause: error }), { code: 'BAD_REQUEST' })

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError.causes.map((cause) => cause.message), [
        'cause 1', 'cause 2', 'cause 3', 'cause 4', 'cause 5', 'cause 6', 'cause 7', 'cause 8'
      ])
    })

    test('should stop at a cause that is already part of the chain', () => {
      const cause = new Error('Provider unreachable')
      const error = Object.assign(new Error('Wallet failed', { cause }), { code: 'BAD_REQUEST' })
      cause.cause = error

      const structuredError = createStructuredError(error)

      assert.deepStrictEqual(structuredError.causes, [
        { name: 'Error', message: 'Provider unreachable' }
      ])
    })
  })
})

describe('toRpcError', () => {
  test('should return a plain error with the structured error as its message and the code as a property', () => {
    const error = Object.assign(new TypeError('Init must be an object'), { code: 'BAD_REQUEST' })

    const rpcError = toRpcError(error)

    assert.strictEqual(Object.getPrototypeOf(rpcError), Error.prototype)
    assert.strictEqual(rpcError.code, 'BAD_REQUEST')
    assert.deepStrictEqual(JSON.parse(rpcError.message), {
      code: 'BAD_REQUEST',
      message: 'Init must be an object',
      name: 'TypeError'
    })
  })
})

describe('callExternal', () => {
  test('should return the result of the call', async () => {
    const result = await callExternal('WALLET_ERROR', async () => ({ address: 'bc1qexample' }))

    assert.deepStrictEqual(result, { address: 'bc1qexample' })
  })

  test('should throw an external error with the code and the thrown value as its cause', async () => {
    const thrown = new Error('No unspent outputs available.')

    const call = callExternal('WALLET_ERROR', () => { throw thrown })

    await assert.rejects(call, (error) => {
      assert.ok(error instanceof ExternalError)
      assert.strictEqual(error.code, 'WALLET_ERROR')
      assert.strictEqual(error.cause, thrown)
      return true
    })
  })
})
