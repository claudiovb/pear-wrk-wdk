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

const { test, describe, beforeEach, mock } = require('node:test')
const assert = require('node:assert')

const HRPC = require('../generated/hrpc')
const BareRPC = require('../generated/bare-rpc')
const { registerRpcHandlers } = require('../src/rpc-handlers')
const { decrypt } = require('../src/utils/crypto')
const { schema: COMMANDS } = require('../src/hrpc/hrpc.json')
const { createPipePair } = require('./helpers/pipe-pair')

const TRANSPORTS = [
  ['HRPC', HRPC],
  ['BareRPC', BareRPC]
]

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// The BIP-39 seed of MNEMONIC with no passphrase.
const SEED = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'

// The entropy MNEMONIC is made from.
const ENTROPY = '00000000000000000000000000000000'

const BITCOIN_CONFIG = { host: 'electrum.example.com' }

const BITCOIN_MANAGER = { name: 'bitcoin manager' }

const VELORA_MANAGER = { name: 'velora manager' }

const CONFIG = JSON.stringify({
  networks: {
    bitcoin: { blockchain: 'bitcoin', config: BITCOIN_CONFIG }
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
    let worklet
    let context
    let wallet
    let account
    let protocol
    let addressBook
    let emitModuleEvent
    let registerWalletMock
    let registerProtocolMock
    let disposeMock

    beforeEach(() => {
      registerWalletMock = mock.fn()
      registerProtocolMock = mock.fn()
      disposeMock = mock.fn()
      wallet = { getAccount: async () => account }
      protocol = {}
      account = { getSwapProtocol: () => protocol }
      addressBook = {}

      context = {
        wdk: null,
        WDK: class {
          registerWallet (...args) { return registerWalletMock(...args) }
          registerProtocol (...args) { return registerProtocolMock(...args) }
          getAccount (network, index) { return wallet.getAccount(network, index) }
          dispose (...args) { return disposeMock(...args) }
        },
        walletManagers: { bitcoin: BITCOIN_MANAGER },
        protocolManagers: { velora: VELORA_MANAGER },
        moduleManagers: {
          addressBook: {
            createModule: ({ emit }) => {
              emitModuleEvent = emit

              return addressBook
            }
          }
        },
        allowedModuleMethods: { addressBook: { methods: ['list', 'add'] } },
        wdkLoadError: null
      }

      ;({ host, worklet } = connect(context))
    })

    /**
     * Register the handlers of a worklet behind a new pair of streams.
     * @param {object} workletContext - The context the handlers run with.
     * @returns {{ host: object, worklet: object }} The two sides of the pair.
     */
    function connect (workletContext) {
      const [hostStream, workletStream] = createPipePair()
      const workletSide = new Transport(workletStream)

      registerRpcHandlers(workletSide, workletContext)

      return { host: new Transport(hostStream), worklet: workletSide }
    }

    async function initializeWdk () {
      const { encryptionKey, encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

      await host.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })
    }

    describe('commands', () => {
      test('should have one method to call and one to register a handler for each command of hrpc.json', () => {
        const expected = COMMANDS.flatMap((command) => {
          const method = command.name.slice(command.name.indexOf('/') + 1)

          return [method, `on${method[0].toUpperCase()}${method.slice(1)}`]
        })

        const methods = Object.getOwnPropertyNames(Transport.prototype)
          .filter((property) => property !== 'constructor' && !property.startsWith('_'))

        assert.deepStrictEqual(methods.sort(), expected.sort())
      })
    })

    describe('workletStart', () => {
      test('should resolve with the started status', async () => {
        const result = await host.workletStart()

        assert.deepStrictEqual(result, { status: 'started' })
      })
    })

    describe('getSeedAndEntropyFromMnemonic', () => {
      test('should resolve with the seed and the entropy of the mnemonic, encrypted, as buffers', async () => {
        const result = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        assert.deepStrictEqual(Object.keys(result).sort(), ['encryptedEntropyBuffer', 'encryptedSeedBuffer', 'encryptionKey'])
        assert.strictEqual(decrypt(result.encryptedSeedBuffer, result.encryptionKey).toString('hex'), SEED)
        assert.strictEqual(decrypt(result.encryptedEntropyBuffer, result.encryptionKey).toString('hex'), ENTROPY)
      })
    })

    describe('getMnemonicFromEntropy', () => {
      test('should resolve with the mnemonic the encrypted entropy was made from', async () => {
        const { encryptionKey, encryptedEntropyBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        const result = await host.getMnemonicFromEntropy({ encryptedEntropy: encryptedEntropyBuffer, encryptionKey })

        assert.deepStrictEqual(result, { mnemonic: MNEMONIC })
      })
    })

    describe('generateEntropyAndEncrypt', () => {
      test('should resolve with the encrypted seed of a new 12 word mnemonic', async () => {
        const result = await host.generateEntropyAndEncrypt({ wordCount: 12 })

        const { mnemonic } = await host.getMnemonicFromEntropy({
          encryptedEntropy: result.encryptedEntropyBuffer,
          encryptionKey: result.encryptionKey
        })
        const fromMnemonic = await host.getSeedAndEntropyFromMnemonic({ mnemonic })

        assert.strictEqual(mnemonic.split(' ').length, 12)
        assert.deepStrictEqual(
          decrypt(result.encryptedSeedBuffer, result.encryptionKey),
          decrypt(fromMnemonic.encryptedSeedBuffer, fromMnemonic.encryptionKey)
        )
      })
    })

    describe('initializeWDK', () => {
      test('should resolve with the initialized status and register the wallets on the decrypted seed', async () => {
        const { encryptionKey, encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        const result = await host.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })

        assert.deepStrictEqual(result, { status: 'initialized' })
        assert.strictEqual(context.wdkSeedBuffer.toString('hex'), SEED)
        assert.deepStrictEqual(registerWalletMock.mock.calls.map((call) => call.arguments), [
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG]
        ])
      })

      test('should keep the WDK instance and its seed when initialized again with a config only', async () => {
        await initializeWdk()
        const wdk = context.wdk

        const result = await host.initializeWDK({ config: CONFIG })

        assert.deepStrictEqual(result, { status: 'initialized' })
        assert.strictEqual(context.wdk, wdk)
        assert.strictEqual(context.wdkSeedBuffer.toString('hex'), SEED)
        assert.deepStrictEqual(registerWalletMock.mock.calls.map((call) => call.arguments), [
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG],
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG]
        ])
      })

      // A WDK instance keeps its seed by reference. Initializing again with a new
      // seed zeroes the old one, so the old instance goes with it.
      describe('again with a new seed, when it fails', () => {
        const FAILURES = [
          ['the new seed cannot be decrypted', { encryptionKey: WRONG_KEY, config: CONFIG }, {
            code: 'DECRYPTION_FAILED',
            name: 'Error',
            message: 'Failed to decrypt seed: Unsupported state or unable to authenticate data'
          }],
          ['the config is not valid', { config: '{"networks":{}}' }, {
            code: 'BAD_REQUEST',
            name: 'Error',
            message: 'At least one network configuration must be provided'
          }]
        ]

        for (const [reason, overrides, expected] of FAILURES) {
          test(`should discard the WDK instance and zero its seed when ${reason}`, async () => {
            await initializeWdk()
            const seed = context.wdkSeedBuffer
            const { encryptionKey, encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

            const call = host.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, ...overrides })

            await assertRejectsWith(call, expected)
            assert.deepStrictEqual(seed, Buffer.alloc(64))
            assert.strictEqual(context.wdk, null)
            assert.strictEqual(context.wdkSeedBuffer, null)
          })
        }

        const NEXT_CALLS = [
          ['registerWallet', (rpc) => rpc.registerWallet({ config: JSON.stringify(JSON.parse(CONFIG).networks) }), 'WDK not initialized. Call initializeWDK first.'],
          ['resetWdkWallets', (rpc) => rpc.resetWdkWallets({ config: CONFIG }), 'WDK must be initialized with a seed before module reset.'],
          ['initializeWDK with a config only', (rpc) => rpc.initializeWDK({ config: CONFIG }), 'WDK must be initialized with a seed before module registration.']
        ]

        for (const [name, next, message] of NEXT_CALLS) {
          test(`should then reject ${name} with WDK_MANAGER_INIT and register no wallet`, async () => {
            await initializeWdk()
            const { encryptedSeedBuffer } = await host.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })
            await assert.rejects(host.initializeWDK({ encryptionKey: WRONG_KEY, encryptedSeed: encryptedSeedBuffer, config: CONFIG }))

            const call = next(host)

            await assertRejectsWith(call, { code: 'WDK_MANAGER_INIT', name: 'Error', message })
            assert.deepStrictEqual(registerWalletMock.mock.calls.map((call) => call.arguments), [
              ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG]
            ])
          })
        }
      })
    })

    describe('callMethod', () => {
      test('should call the method of the account with the arguments and resolve with its result as JSON', async () => {
        await initializeWdk()
        account.sendTransaction = mock.fn(async () => ({ hash: 'f4184fc5', fee: 141 }))

        const result = await host.callMethod({
          methodName: 'sendTransaction',
          network: 'bitcoin',
          accountIndex: 0,
          args: JSON.stringify({ to: 'bc1qexample', value: 1000 })
        })

        assert.deepStrictEqual(result, { result: '{"hash":"f4184fc5","fee":141}' })
        assert.deepStrictEqual(account.sendTransaction.mock.calls.map((call) => call.arguments), [
          [{ to: 'bc1qexample', value: 1000 }]
        ])
      })
    })

    describe('registerWallet', () => {
      test('should register the wallet and resolve with the registered blockchains', async () => {
        await initializeWdk()

        const result = await host.registerWallet({
          config: JSON.stringify({ bitcoin: { blockchain: 'bitcoin', config: BITCOIN_CONFIG } })
        })

        assert.deepStrictEqual(result, { status: 'registered', blockchains: '["bitcoin"]' })
        assert.deepStrictEqual(registerWalletMock.mock.calls.map((call) => call.arguments), [
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG],
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG]
        ])
      })
    })

    describe('registerProtocol', () => {
      test('should register the protocol and resolve with the registered status', async () => {
        await initializeWdk()

        const result = await host.registerProtocol({
          config: JSON.stringify({ velora: { blockchain: 'bitcoin', protocolName: 'velora', config: { slippage: 1 } } })
        })

        assert.deepStrictEqual(result, { status: 'registered' })
        assert.deepStrictEqual(registerProtocolMock.mock.calls.map((call) => call.arguments), [
          ['bitcoin', 'velora', VELORA_MANAGER, { slippage: 1 }]
        ])
      })
    })

    describe('resetWdkWallets', () => {
      test('should dispose the wallets of the config, register them again and resolve with the reset status', async () => {
        await initializeWdk()

        const result = await host.resetWdkWallets({ config: CONFIG })

        assert.deepStrictEqual(result, { status: 'reset' })
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[['bitcoin']]])
        assert.deepStrictEqual(registerWalletMock.mock.calls.map((call) => call.arguments), [
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG],
          ['bitcoin', BITCOIN_MANAGER, BITCOIN_CONFIG]
        ])
      })
    })

    describe('events', () => {
      test('should deliver a log sent by the worklet to the host', async () => {
        const received = new Promise((resolve) => host.onLog(resolve))

        worklet.log({ type: 2, data: 'Failed to reach the node' })

        assert.deepStrictEqual(await received, { type: 2, data: 'Failed to reach the node' })
      })

      test('should deliver an event emitted by a module to the host', async () => {
        await initializeWdk()
        const received = new Promise((resolve) => host.onModuleEvent(resolve))

        emitModuleEvent('changed', { contacts: 2 })

        assert.deepStrictEqual(await received, { module: 'addressBook', event: 'changed', payload: '{"contacts":2}' })
      })
    })

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

    describe('dispose', () => {
      test('should resolve with the disposed status and discard the WDK instance', async () => {
        await initializeWdk()

        const result = await host.dispose({})

        assert.deepStrictEqual(result, { status: 'disposed' })
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[]])
        assert.strictEqual(context.wdk, null)
        assert.strictEqual(context.wdkSeedBuffer, null)
      })

      test('should dispose only the given blockchains and keep the seed', async () => {
        await initializeWdk()
        const wdk = context.wdk
        const seed = Buffer.from(context.wdkSeedBuffer)

        const result = await host.dispose({ blockchains: ['bitcoin'] })

        assert.deepStrictEqual(result, { status: 'disposed' })
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[['bitcoin']]])
        assert.strictEqual(context.wdk, wdk)
        assert.deepStrictEqual(context.wdkSeedBuffer, seed)
      })

      test('should dispose everything when the list of blockchains is empty', async () => {
        await initializeWdk()

        const result = await host.dispose({ blockchains: [] })

        assert.deepStrictEqual(result, { status: 'disposed' })
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[]])
        assert.strictEqual(context.wdk, null)
        assert.strictEqual(context.wdkSeedBuffer, null)
      })

      test('should discard the WDK instance and zero its seed before closing the modules', async () => {
        await initializeWdk()
        const seed = context.wdkSeedBuffer
        const neverCloses = new Promise(() => {})
        addressBook.close = mock.fn(() => neverCloses)

        host.dispose({})
        // The dispose is still waiting for the module when a later call is answered.
        await host.ping()
        await host.ping()

        assert.strictEqual(addressBook.close.mock.callCount(), 1)
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[]])
        assert.deepStrictEqual(seed, Buffer.alloc(64))
        assert.strictEqual(context.wdk, null)
      })

      test('should reject when the WDK fails to dispose and keep answering', async () => {
        await initializeWdk()
        disposeMock.mock.mockImplementation(() => { throw new Error('Socket already closed') })

        const call = host.dispose({})

        await assertRejectsWith(call, {
          code: 'WALLET_ERROR',
          name: 'Error',
          message: 'Socket already closed'
        })
        assert.strictEqual(context.wdk, null)
        assert.deepStrictEqual(await host.ping(), {})
      })
    })

    // A host can send a call before the answer to the last one. The calls that
    // change the WDK instance must then run one after the other.
    describe('calls that overlap', () => {
      test('should dispose the first WDK instance and zero its seed when a second initializeWDK is sent before the first has answered', async () => {
        const seeds = []
        const { host: recordingHost } = connect({
          ...context,
          WDK: class extends context.WDK {
            constructor (seed) {
              super()
              seeds.push(seed)
            }
          }
        })
        const first = await recordingHost.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })
        const second = await recordingHost.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        const results = await Promise.all([
          recordingHost.initializeWDK({ encryptionKey: first.encryptionKey, encryptedSeed: first.encryptedSeedBuffer, config: CONFIG }),
          recordingHost.initializeWDK({ encryptionKey: second.encryptionKey, encryptedSeed: second.encryptedSeedBuffer, config: CONFIG })
        ])

        assert.deepStrictEqual(results, [{ status: 'initialized' }, { status: 'initialized' }])
        assert.deepStrictEqual(disposeMock.mock.calls.map((call) => call.arguments), [[]])
        assert.deepStrictEqual(seeds.map((seed) => seed.toString('hex')), ['00'.repeat(64), SEED])
      })
    })

    describe('callModule', () => {
      test('should call the method of the module with the arguments and resolve with its result as JSON', async () => {
        await initializeWdk()
        addressBook.add = mock.fn(async () => ({ id: 7 }))

        const result = await host.callModule({
          module: 'addressBook',
          method: 'add',
          args: JSON.stringify([{ name: 'Alice' }])
        })

        assert.deepStrictEqual(result, { result: '{"id":7}' })
        assert.deepStrictEqual(addressBook.add.mock.calls.map((call) => call.arguments), [[{ name: 'Alice' }]])
      })

      for (const [kind, add] of [['a method', () => {}], ['an async method', async () => {}]]) {
        test(`should resolve with null as JSON when ${kind} of the module returns nothing`, async () => {
          await initializeWdk()
          addressBook.add = mock.fn(add)

          const result = await host.callModule({
            module: 'addressBook',
            method: 'add',
            args: JSON.stringify([{ name: 'Alice' }])
          })

          assert.deepStrictEqual(result, { result: 'null' })
          assert.deepStrictEqual(addressBook.add.mock.calls.map((call) => call.arguments), [[{ name: 'Alice' }]])
        })
      }

      test('should reject with BAD_REQUEST when no modules are bundled and keep answering', async () => {
        const { moduleManagers, ...contextWithoutModules } = context
        const { host: hostWithoutModules } = connect(contextWithoutModules)

        const call = hostWithoutModules.callModule({ module: 'addressBook', method: 'list' })

        await assertRejectsWith(call, {
          code: 'BAD_REQUEST',
          name: 'Error',
          message: 'No modules are bundled in this worklet'
        })
        assert.deepStrictEqual(await hostWithoutModules.ping(), {})
      })
    })

    describe('error codes', () => {
      test('should reject with WDK_MANAGER_INIT and the load error as its cause when the WDK failed to load', async () => {
        const { WDK, ...contextWithoutWdk } = context
        const loadError = new Error("Cannot find module '@tetherto/wdk'")
        const { host: hostWithoutWdk } = connect({ ...contextWithoutWdk, wdkLoadError: loadError })
        const { encryptionKey, encryptedSeedBuffer } = await hostWithoutWdk.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })

        const call = hostWithoutWdk.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })

        await assertRejectsWith(call, {
          code: 'WDK_MANAGER_INIT',
          name: 'Error',
          message: "WDK failed to load: Cannot find module '@tetherto/wdk'",
          causes: [
            { name: 'Error', message: "Cannot find module '@tetherto/wdk'" }
          ]
        })
      })

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

      test('should reject with METHOD_NOT_ALLOWED when the method of the account is not in the allowed list', async () => {
        context.allowedMethods = { bitcoin: { methods: ['getAddress'] } }
        await initializeWdk()
        account.sendTransaction = mock.fn(async () => ({ hash: 'f4184fc5' }))

        const call = host.callMethod({ methodName: 'sendTransaction', network: 'bitcoin', accountIndex: 0 })

        await assertRejectsWith(call, {
          code: 'METHOD_NOT_ALLOWED',
          name: 'Error',
          message: 'Method "sendTransaction" is not allowed for network "bitcoin".'
        })
        assert.strictEqual(account.sendTransaction.mock.callCount(), 0)
      })

      test('should reject with METHOD_NOT_ALLOWED when the method of the module is not in the allowed list', async () => {
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
