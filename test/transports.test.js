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
  }
})

for (const [name, Transport] of TRANSPORTS) {
  describe(`${name} transport`, () => {
    let host
    let account

    beforeEach(() => {
      account = {}

      const context = {
        wdk: null,
        WDK: class {
          registerWallet () {}
          async getAccount () { return account }
          dispose () {}
        },
        walletManagers: { bitcoin: {} },
        protocolManagers: {},
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

    describe('errors', () => {
      test('should reject with the code and the message of an error raised by a handler', async () => {
        const call = host.callMethod({ methodName: 'getAddress', network: 'bitcoin', accountIndex: 0 })

        await assert.rejects(call, (error) => {
          assert.strictEqual(error.code, 'WDK_MANAGER_INIT')
          assert.deepStrictEqual(JSON.parse(error.message), {
            code: 'WDK_MANAGER_INIT',
            message: 'WDK not initialized. Call initializeWDK first.',
            name: 'Error'
          })
          return true
        })
      })

      test('should reject with the name, the details and the causes of an error thrown by a wallet method', async () => {
        await initializeWdk()
        account.sendTransaction = async () => {
          const cause = Object.assign(new Error('429 Too Many Requests'), { name: 'HttpError', httpStatus: 429 })

          throw Object.assign(new Error('No unspent outputs available.', { cause }), {
            name: 'TransactionError',
            reason: 'INSUFFICIENT_BALANCE'
          })
        }

        const call = host.callMethod({ methodName: 'sendTransaction', network: 'bitcoin', accountIndex: 0 })

        await assert.rejects(call, (error) => {
          assert.strictEqual(error.code, 'UNKNOWN')
          assert.deepStrictEqual(JSON.parse(error.message), {
            code: 'UNKNOWN',
            message: 'No unspent outputs available.',
            name: 'TransactionError',
            details: { reason: 'INSUFFICIENT_BALANCE' },
            causes: [
              { name: 'HttpError', message: '429 Too Many Requests', details: { httpStatus: 429 } }
            ]
          })
          return true
        })
      })
    })
  })
}
