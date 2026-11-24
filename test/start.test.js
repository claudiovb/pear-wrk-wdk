#!/usr/bin/env node

/**
 * Tests for the entry bare-stow runs: createStart(context) gives the start
 * function of the worklet, and start gives back the stop function.
 *
 * Every case runs once per transport. bare-stow is stood in for by calling
 * start with the transport, as its runtime does, over an in-memory pipe.
 *
 * Run with: node --test test/start.test.js
 */

// Load test setup first to mock bare-crypto
require('./setup.js')

const { test, describe, beforeEach, mock } = require('node:test')
const assert = require('node:assert')

const { createStart } = require('@tetherto/pear-wrk-wdk/worklet')
const HRPC = require('@tetherto/pear-wrk-wdk/hrpc')
const BareRPC = require('@tetherto/pear-wrk-wdk/bare-rpc')
const { createPipePair } = require('./helpers/pipe-pair')

const TRANSPORTS = [
  ['HRPC', HRPC],
  ['BareRPC', BareRPC]
]

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// The BIP-39 seed of MNEMONIC with no passphrase.
const SEED = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'

const BITCOIN_MANAGER = { name: 'bitcoin manager' }

const CONFIG = JSON.stringify({
  networks: {
    bitcoin: { blockchain: 'bitcoin', config: { host: 'electrum.example.com' } }
  },
  modules: {
    addressBook: {}
  }
})

for (const [name, Transport] of TRANSPORTS) {
  describe(`createStart over ${name}`, () => {
    let host
    let context
    let stop
    let disposeMock
    let closeMock

    beforeEach(() => {
      disposeMock = mock.fn()
      closeMock = mock.fn()

      context = {
        wdk: null,
        WDK: class {
          registerWallet () {}
          dispose (...args) { return disposeMock(...args) }
        },
        walletManagers: { bitcoin: BITCOIN_MANAGER },
        protocolManagers: {},
        moduleManagers: {
          addressBook: {
            createModule: () => ({ close: closeMock })
          }
        },
        wdkLoadError: null
      }

      const [hostStream, workletStream] = createPipePair()

      host = new Transport(hostStream)
      stop = createStart(context)({ rpc: new Transport(workletStream), ipc: workletStream })
    })

    async function initializeWdk () {
      const { encryptionKey, encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

      await host.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })
    }

    describe('start', () => {
      test('should answer the commands once it has returned', async () => {
        const result = await host.workletStart()

        assert.deepStrictEqual(result, { status: 'started' })
      })
    })

    describe('stop', () => {
      test('should dispose the WDK instance, zero the seed and close the modules', async () => {
        await initializeWdk()
        const seed = context.wdkSeedBuffer
        const seedBefore = seed.toString('hex')

        await stop()

        assert.strictEqual(seedBefore, SEED)
        assert.deepStrictEqual(seed, Buffer.alloc(64))
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[]])
        assert.deepStrictEqual(closeMock.mock.calls.map((call) => call.arguments), [[]])
        assert.strictEqual(context.wdk, null)
        assert.strictEqual(context.wdkSeedBuffer, null)
      })

      test('should resolve with nothing when the WDK was never initialized', async () => {
        const result = await stop()

        assert.strictEqual(result, undefined)
        assert.strictEqual(disposeMock.mock.callCount(), 0)
      })

      test('should reject with the error of the dispose command when the WDK fails to dispose, and still discard it and zero the seed', async () => {
        await initializeWdk()
        const seed = context.wdkSeedBuffer
        disposeMock.mock.mockImplementation(() => { throw new Error('Socket already closed') })

        await assert.rejects(stop(), {
          code: 'WALLET_ERROR',
          message: '{"code":"WALLET_ERROR","name":"Error","message":"Socket already closed"}'
        })

        assert.deepStrictEqual(seed, Buffer.alloc(64))
        assert.strictEqual(context.wdk, null)
        assert.strictEqual(context.wdkSeedBuffer, null)
      })
    })
  })
}
