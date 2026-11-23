#!/usr/bin/env node

/**
 * Integration tests for the handlers behind each transport.
 *
 * Every case runs once per transport, over two instances of its generated
 * class connected by an in-memory pipe: the worklet side registers the full
 * handler set (registerRpcHandlers) and the host side makes the calls. A case
 * therefore asserts what a host really receives.
 *
 * Run with: node --test test/transports.test.js
 */

// Load test setup first to mock bare-crypto
require('./setup.js')

const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert')

const HRPC = require('../generated/hrpc')
const { registerRpcHandlers } = require('../src/rpc-handlers')
const { createPipePair } = require('./helpers/pipe-pair')

const TRANSPORTS = [
  ['HRPC', HRPC]
]

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const CONFIG = JSON.stringify({
  networks: {
    bitcoin: { blockchain: 'bitcoin', config: { host: 'electrum.example.com' } }
  },
  modules: {
    addressBook: {}
  }
})

const SWAP_OPTIONS = JSON.stringify({ protocolType: 'swap', protocolName: 'velora' })

// A key of the right size that is not the one the secrets were encrypted with.
const WRONG_KEY = Buffer.alloc(32, 7)

/**
 * Assert that a call rejects with the given structured error, both as the JSON
 * of the message and as the code the transport carries next to it.
 * @param {Promise<unknown>} call - The call the host made.
 * @param {object} expected - The structured error the host must receive.
 */
async function assertRejectsWith (call, expected) {
  await assert.rejects(call, (error) => {
    assert.strictEqual(error.code, expected.code)
    assert.deepStrictEqual(JSON.parse(error.message), expected)
    return true
  })
}

for (const [name, Transport] of TRANSPORTS) {
  describe(`${name} transport`, () => {
    let host
    let context
    let wallet
    let account
    let protocol
    let addressBook

    beforeEach(() => {
      wallet = { getAccount: async () => account }
      protocol = {}
      account = { getSwapProtocol: () => protocol }
      addressBook = {}

      context = {
        wdk: null,
        WDK: class {
          registerWallet () {}
          getAccount (network, index) { return wallet.getAccount(network, index) }
          dispose () {}
        },
        walletManagers: { bitcoin: {} },
        protocolManagers: {},
        moduleManagers: { addressBook: { createModule: () => addressBook } },
        allowedModuleMethods: { addressBook: { methods: ['list', 'add'] } },
        wdkLoadError: null
      }

      const [hostStream, workletStream] = createPipePair()

      registerRpcHandlers(new Transport(workletStream), context)

      host = new Transport(hostStream)
    })

    async function initializeWdk () {
      const { encryptionKey, encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

      await host.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })
    }

    describe('ping', () => {
      test('should resolve with an empty object when called with no argument', async () => {
        const result = await host.ping()

        assert.deepStrictEqual(result, {})
      })

      test('should answer while a wallet call is still running', async () => {
        let finishGetBalance
        await initializeWdk()
        account.getBalance = () => new Promise((resolve) => { finishGetBalance = resolve })
        const call = host.callMethod({ methodName: 'getBalance', network: 'bitcoin', accountIndex: 0 })

        const result = await host.ping()

        assert.deepStrictEqual(result, {})

        finishGetBalance(1000)
        assert.deepStrictEqual(await call, { result: '1000' })
      })
    })

    describe('error codes', () => {
      test('should reject with WDK_MANAGER_INIT when the WDK is not initialized', async () => {
        const call = host.callMethod({ methodName: 'getAddress', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'WDK_MANAGER_INIT',
          name: 'Error',
          message: 'WDK not initialized. Call initializeWDK first.'
        })
      })

      test('should reject with BAD_REQUEST when a field of the request is not valid', async () => {
        const call = host.callMethod({ methodName: '', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'BAD_REQUEST',
          name: 'Error',
          message: 'methodName must be a non-empty string'
        })
      })

      test('should reject with DECRYPTION_FAILED when the seed cannot be decrypted', async () => {
        const { encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        const call = host.initializeWDK({
          encryptedSeed: encryptedSeedBuffer,
          encryptionKey: WRONG_KEY,
          config: CONFIG
        })

        await assertRejectsWith(call, {
          code: 'DECRYPTION_FAILED',
          name: 'Error',
          message: 'Failed to decrypt seed: Unsupported state or unable to authenticate data'
        })
      })

      test('should reject with DECRYPTION_FAILED when the entropy cannot be decrypted', async () => {
        const { encryptedEntropyBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        const call = host.getMnemonicFromEntropy({
          encryptedEntropy: encryptedEntropyBuffer,
          encryptionKey: WRONG_KEY
        })

        await assertRejectsWith(call, {
          code: 'DECRYPTION_FAILED',
          name: 'Error',
          message: 'Failed to decrypt entropy: Unsupported state or unable to authenticate data'
        })
      })

      test('should reject with METHOD_NOT_ALLOWED when the method is not in the allowed list', async () => {
        await initializeWdk()

        const call = host.callModule({ module: 'addressBook', method: 'remove' })

        await assertRejectsWith(call, {
          code: 'METHOD_NOT_ALLOWED',
          name: 'Error',
          message: 'Method "remove" is not allowed for module "addressBook".'
        })
      })

      test('should reject with WALLET_ERROR, the details and the causes when a wallet method throws', async () => {
        await initializeWdk()
        account.sendTransaction = async () => {
          const cause = Object.assign(new Error('429 Too Many Requests'), { name: 'HttpError', httpStatus: 429 })

          throw Object.assign(new Error('No unspent outputs available.', { cause }), {
            name: 'TransactionError',
            reason: 'INSUFFICIENT_BALANCE'
          })
        }

        const call = host.callMethod({ methodName: 'sendTransaction', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'WALLET_ERROR',
          name: 'TransactionError',
          message: 'No unspent outputs available.',
          details: { reason: 'INSUFFICIENT_BALANCE' },
          causes: [
            { name: 'HttpError', message: '429 Too Many Requests', details: { httpStatus: 429 } }
          ]
        })
      })

      test('should reject with WALLET_ERROR and keep the code of a library in the details', async () => {
        await initializeWdk()
        account.sendTransaction = async () => {
          throw Object.assign(new Error('insufficient funds for intrinsic transaction cost'), { code: 'INSUFFICIENT_FUNDS' })
        }

        const call = host.callMethod({ methodName: 'sendTransaction', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'WALLET_ERROR',
          name: 'Error',
          message: 'insufficient funds for intrinsic transaction cost',
          details: { code: 'INSUFFICIENT_FUNDS' }
        })
      })

      test('should reject with WALLET_ERROR when the account cannot be resolved', async () => {
        await initializeWdk()
        wallet.getAccount = async () => { throw new Error('Wallet for bitcoin is not registered') }

        const call = host.callMethod({ methodName: 'getAddress', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'WALLET_ERROR',
          name: 'Error',
          message: 'Failed to get account for network "bitcoin" at index 0: Wallet for bitcoin is not registered',
          causes: [
            { name: 'Error', message: 'Wallet for bitcoin is not registered' }
          ]
        })
      })

      test('should reject with PROTOCOL_ERROR when a protocol method throws', async () => {
        await initializeWdk()
        protocol.quoteSwap = async () => {
          throw Object.assign(new Error("Operation 'quoteSwap' is not supported by this protocol."), { name: 'UnsupportedOperationError' })
        }

        const call = host.callMethod({ methodName: 'quoteSwap', network: 'bitcoin', accountIndex: 0, options: SWAP_OPTIONS })

        await assertRejectsWith(call, {
          code: 'PROTOCOL_ERROR',
          name: 'UnsupportedOperationError',
          message: "Operation 'quoteSwap' is not supported by this protocol."
        })
      })

      test('should reject with MODULE_ERROR when a module method throws', async () => {
        await initializeWdk()
        addressBook.add = async () => {
          throw Object.assign(new Error('Address book is full'), { name: 'StorageError', limit: 100 })
        }

        const call = host.callModule({ module: 'addressBook', method: 'add' })

        await assertRejectsWith(call, {
          code: 'MODULE_ERROR',
          name: 'StorageError',
          message: 'Address book is full',
          details: { limit: 100 }
        })
      })

      test('should also carry the stack trace when the context is the one of a debug build', async () => {
        context.debug = true
        await initializeWdk()
        account.sendTransaction = async () => {
          const error = Object.assign(new Error('No unspent outputs available.'), { name: 'TransactionError' })
          error.stack = 'TransactionError: No unspent outputs available.\n    at sendTransaction (wallet-account-btc.js:20:9)'

          throw error
        }

        const call = host.callMethod({ methodName: 'sendTransaction', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'WALLET_ERROR',
          name: 'TransactionError',
          message: 'No unspent outputs available.',
          stack: 'TransactionError: No unspent outputs available.\n    at sendTransaction (wallet-account-btc.js:20:9)'
        })
      })

      test('should reject with INTERNAL_ERROR when the code of the worklet itself fails', async () => {
        await initializeWdk()
        context.walletManagers = null

        const call = host.registerWallet({
          config: JSON.stringify({ bitcoin: { blockchain: 'bitcoin', config: { host: 'electrum.example.com' } } })
        })

        await assertRejectsWith(call, {
          code: 'INTERNAL_ERROR',
          name: 'TypeError',
          message: "Cannot read properties of null (reading 'bitcoin')"
        })
      })
    })
  })
}
