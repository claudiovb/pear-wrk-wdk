#!/usr/bin/env node

/**
 * Unit tests for RPC handlers
 *
 * Run with: node --test test/rpc-handlers.test.js
 */

// Load test setup first to mock bare-crypto
require('./setup.js')

const { test, describe, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert')

// Mock dependencies
const mockRpc = {
  handlers: {},
  onWorkletStart: function (handler) { this.handlers.workletStart = handler },
  onGenerateEntropyAndEncrypt: function (handler) { this.handlers.generateEntropyAndEncrypt = handler },
  onGetMnemonicFromEntropy: function (handler) { this.handlers.getMnemonicFromEntropy = handler },
  onGetSeedAndEntropyFromMnemonic: function (handler) { this.handlers.getSeedAndEntropyFromMnemonic = handler },
  onInitializeWDK: function (handler) { this.handlers.initializeWDK = handler },
  onCallMethod: function (handler) { this.handlers.callMethod = handler },
  onRegisterWallet: function (handler) { this.handlers.registerWallet = handler },
  onRegisterProtocol: function (handler) { this.handlers.registerProtocol = handler },
  onDispose: function (handler) { this.handlers.dispose = handler },
  onResetWdkWallets: function (handler) { this.handlers.resetWdkWallets = handler },
  // Generic module subsystem (only wired when context.moduleManagers is set).
  onCallModule: function (handler) { this.handlers.callModule = handler },
  moduleEvent: function (payload) { (this.events ||= []).push(payload) }
}

describe('RPC Handlers', () => {
  let registerRpcHandlers
  let context

  beforeEach(() => {
    // Clear handlers
    mockRpc.handlers = {}

    // Import the module (we'll need to mock some dependencies)
    // For now, we'll test the exported functions directly
    const rpcHandlers = require('../src/rpc-handlers')
    registerRpcHandlers = rpcHandlers.registerRpcHandlers

    // Create a mock context
    context = {
      wdk: null,
      WDK: class MockWDK {
        constructor (seed) {
          this.seed = seed
          this.wallets = {}
        }

        registerWallet (network, manager, config) {
          this.wallets[network] = { manager, config }
        }

        async getAccount (network, index) {
          if (!this.wallets[network]) {
            throw new Error(`Network ${network} not registered`)
          }
          return {
            getAddress: async () => ({ address: `0x${network}-${index}` }),
            getBalance: async () => ({ balance: '1000000000000000000' })
          }
        }

        dispose () {
          this.wallets = {}
        }
      },
      walletManagers: {
        ethereum: { name: 'EthereumManager' },
        spark: { name: 'SparkManager' }
      },
      requiredNetworks: ['ethereum', 'spark'],
      wdkLoadError: null
    }
  })

  afterEach(() => {
    if (context.wdk) {
      context.wdk.dispose()
      context.wdk = null
    }
  })

  describe('registerRpcHandlers', () => {
    test('should register all RPC handlers', () => {
      registerRpcHandlers(mockRpc, context)

      assert.ok(mockRpc.handlers.workletStart, 'workletStart handler should be registered')
      assert.ok(mockRpc.handlers.generateEntropyAndEncrypt, 'generateEntropyAndEncrypt handler should be registered')
      assert.ok(mockRpc.handlers.getMnemonicFromEntropy, 'getMnemonicFromEntropy handler should be registered')
      assert.ok(mockRpc.handlers.getSeedAndEntropyFromMnemonic, 'getSeedAndEntropyFromMnemonic handler should be registered')
      assert.ok(mockRpc.handlers.initializeWDK, 'initializeWDK handler should be registered')
      assert.ok(mockRpc.handlers.callMethod, 'callMethod handler should be registered')
      assert.ok(mockRpc.handlers.dispose, 'dispose handler should be registered')
    })
  })

  describe('workletStart', () => {
    test('should return started status', async () => {
      registerRpcHandlers(mockRpc, context)
      const result = await mockRpc.handlers.workletStart({})
      assert.strictEqual(result.status, 'started')
    })
  })

  describe('generateEntropyAndEncrypt', () => {
    test('should generate entropy and encrypt for 12 words', async () => {
      registerRpcHandlers(mockRpc, context)
      const result = await mockRpc.handlers.generateEntropyAndEncrypt({ wordCount: 12 })

      assert.ok(result.encryptionKey, 'encryptionKey should be present')
      assert.ok(result.encryptedSeedBuffer, 'encryptedSeedBuffer should be present')
      assert.ok(result.encryptedEntropyBuffer, 'encryptedEntropyBuffer should be present')
      assert.strictEqual(typeof result.encryptionKey, 'string')
      assert.strictEqual(typeof result.encryptedSeedBuffer, 'string')
      assert.strictEqual(typeof result.encryptedEntropyBuffer, 'string')
    })

    test('should generate entropy and encrypt for 24 words', async () => {
      registerRpcHandlers(mockRpc, context)
      const result = await mockRpc.handlers.generateEntropyAndEncrypt({ wordCount: 24 })

      assert.ok(result.encryptionKey, 'encryptionKey should be present')
      assert.ok(result.encryptedSeedBuffer, 'encryptedSeedBuffer should be present')
      assert.ok(result.encryptedEntropyBuffer, 'encryptedEntropyBuffer should be present')
    })

    test('should reject invalid word count', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.generateEntropyAndEncrypt({ wordCount: 15 }),
        /wordCount must be 12 or 24/
      )
    })

    test('should reject missing word count', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.generateEntropyAndEncrypt({}),
        /wordCount must be 12 or 24/
      )
    })
  })

  describe('getMnemonicFromEntropy', () => {
    test('should decrypt entropy and return mnemonic', async () => {
      registerRpcHandlers(mockRpc, context)

      // First generate entropy
      const generated = await mockRpc.handlers.generateEntropyAndEncrypt({ wordCount: 12 })

      // Then get mnemonic from encrypted entropy
      const result = await mockRpc.handlers.getMnemonicFromEntropy({
        encryptedEntropy: generated.encryptedEntropyBuffer,
        encryptionKey: generated.encryptionKey
      })

      assert.ok(result.mnemonic, 'mnemonic should be present')
      assert.strictEqual(typeof result.mnemonic, 'string')
      const words = result.mnemonic.split(' ')
      assert.strictEqual(words.length, 12, 'mnemonic should have 12 words')
    })

    test('should reject invalid encrypted entropy', async () => {
      registerRpcHandlers(mockRpc, context)

      // Test with invalid base64 (contains invalid characters)
      await assert.rejects(
        async () => await mockRpc.handlers.getMnemonicFromEntropy({
          encryptedEntropy: 'invalid@#$%',
          encryptionKey: 'dGVzdA=='
        }),
        (error) => {
          // Should fail either during validation or decryption
          const errorStr = error.message || String(error)
          return errorStr.includes('encryptedEntropy') ||
                 errorStr.includes('base64') ||
                 errorStr.includes('Invalid') ||
                 errorStr.includes('BAD_REQUEST')
        }
      )
    })

    test('should reject missing encryption key', async () => {
      registerRpcHandlers(mockRpc, context)

      const generated = await mockRpc.handlers.generateEntropyAndEncrypt({ wordCount: 12 })

      await assert.rejects(
        async () => await mockRpc.handlers.getMnemonicFromEntropy({
          encryptedEntropy: generated.encryptedEntropyBuffer
        }),
        /encryptionKey/
      )
    })
  })

  describe('getSeedAndEntropyFromMnemonic', () => {
    test('should convert mnemonic to encrypted seed and entropy', async () => {
      registerRpcHandlers(mockRpc, context)

      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const result = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })

      assert.ok(result.encryptionKey, 'encryptionKey should be present')
      assert.ok(result.encryptedSeedBuffer, 'encryptedSeedBuffer should be present')
      assert.ok(result.encryptedEntropyBuffer, 'encryptedEntropyBuffer should be present')
    })

    test('should reject mnemonic with wrong word count', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.getSeedAndEntropyFromMnemonic({
          mnemonic: 'invalid mnemonic'
        }),
        /mnemonic must contain exactly 12 or 24 words/
      )
    })

    test('should reject mnemonic with a non-BIP39 word', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.getSeedAndEntropyFromMnemonic({
          mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword'
        }),
        /contains words not in the BIP-39 wordlist.*notaword.*position 12/
      )
    })

    test('should reject mnemonic with multiple non-BIP39 words', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.getSeedAndEntropyFromMnemonic({
          mnemonic: 'abandon typo1 abandon abandon abandon abandon abandon abandon abandon abandon abandon typo2'
        }),
        /contains words not in the BIP-39 wordlist.*typo1.*position 2.*typo2.*position 12/
      )
    })

    test('should reject missing mnemonic', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.getSeedAndEntropyFromMnemonic({}),
        /mnemonic/
      )
    })
  })

  describe('initializeWDK', () => {
    test('should initialize WDK with valid config', async () => {
      registerRpcHandlers(mockRpc, context)

      // First generate seed and entropy
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })

      // Initialize WDK
      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } },
          spark: { blockchain: 'spark', config: { rpcUrl: 'https://spark.example.com' } }
        }
      }

      const result = await mockRpc.handlers.initializeWDK({
        config: JSON.stringify(config),
        encryptionKey: seedData.encryptionKey,
        encryptedSeed: seedData.encryptedSeedBuffer
      })

      assert.strictEqual(result.status, 'initialized')
      assert.ok(context.wdk, 'WDK should be initialized')
    })

    test('should reject missing network config', async () => {
      registerRpcHandlers(mockRpc, context)

      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })

      const config = {
        networks: {}
      }

      await assert.rejects(
        async () => await mockRpc.handlers.initializeWDK({
          config: JSON.stringify(config),
          encryptionKey: seedData.encryptionKey,
          encryptedSeed: seedData.encryptedSeedBuffer
        }),
        /At least one network configuration must be provided/
      )
    })

    test('should reject invalid config JSON', async () => {
      registerRpcHandlers(mockRpc, context)

      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })

      await assert.rejects(
        async () => await mockRpc.handlers.initializeWDK({
          config: 'invalid json',
          encryptionKey: seedData.encryptionKey,
          encryptedSeed: seedData.encryptedSeedBuffer
        }),
        /config must be valid JSON/
      )
    })

    test('should reject missing encryption key', async () => {
      registerRpcHandlers(mockRpc, context)

      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } },
          spark: { blockchain: 'spark', config: { rpcUrl: 'https://spark.example.com' } }
        }
      }

      await assert.rejects(
        async () => await mockRpc.handlers.initializeWDK({
          config: JSON.stringify(config),
          encryptedSeed: 'some-encrypted-seed'
        }),
        /encryptionKey.*must be provided or omitted/
      )
    })

    test('constructs configured modules with the seed at init and does NOT retain it', async () => {
      const { mnemonicToSeedSync } = require('@scure/bip39')
      // The factory consumes the seed synchronously during construction, so it
      // copies it here; the worklet then zeroes the original.
      let capturedSeed = null
      context.moduleManagers = {
        addressBook: {
          createModule: (ctx) => { capturedSeed = Buffer.from(ctx.seed); return {} }
        }
      }
      registerRpcHandlers(mockRpc, context)

      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })
      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } }
        },
        modules: { addressBook: { namespace: 'tether-wallet' } }
      }

      await mockRpc.handlers.initializeWDK({
        config: JSON.stringify(config),
        encryptionKey: seedData.encryptionKey,
        encryptedSeed: seedData.encryptedSeedBuffer
      })

      assert.ok(capturedSeed, 'module was constructed with a seed')
      assert.strictEqual(capturedSeed.length, 64, 'module received the 64-byte BIP39 seed')
      assert.ok(
        capturedSeed.equals(Buffer.from(mnemonicToSeedSync(mnemonic))),
        'seed handed to the factory equals mnemonicToSeedSync(mnemonic)'
      )
      assert.strictEqual(context.seed, undefined, 'raw seed is NOT retained on the context')
    })

    test('does not retain the seed when no modules are configured', async () => {
      registerRpcHandlers(mockRpc, context)
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })
      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } }
        }
      }
      await mockRpc.handlers.initializeWDK({
        config: JSON.stringify(config),
        encryptionKey: seedData.encryptionKey,
        encryptedSeed: seedData.encryptedSeedBuffer
      })
      assert.strictEqual(context.seed, undefined, 'seed is not retained')
    })

    test('re-init closes the previous modules and reconstructs them', async () => {
      const closed = []
      let constructed = 0
      context.moduleManagers = {
        addressBook: {
          createModule: () => { const id = ++constructed; return { id, close: () => { closed.push(id) } } }
        }
      }
      registerRpcHandlers(mockRpc, context)
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })
      const config = {
        networks: { ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } } },
        modules: { addressBook: {} }
      }
      const initArgs = { config: JSON.stringify(config), encryptionKey: seedData.encryptionKey, encryptedSeed: seedData.encryptedSeedBuffer }

      await mockRpc.handlers.initializeWDK(initArgs)
      assert.strictEqual(constructed, 1, 'module constructed on first init')

      await mockRpc.handlers.initializeWDK(initArgs)
      assert.deepStrictEqual(closed, [1], 'previous module instance closed on re-init')
      assert.strictEqual(constructed, 2, 'module reconstructed on re-init')
    })
  })

  describe('callMethod', () => {
    test('should call WDK method successfully', async () => {
      registerRpcHandlers(mockRpc, context)

      // Initialize WDK first
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })
      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } },
          spark: { blockchain: 'spark', config: { rpcUrl: 'https://spark.example.com' } }
        }
      }
      await mockRpc.handlers.initializeWDK({
        config: JSON.stringify(config),
        encryptionKey: seedData.encryptionKey,
        encryptedSeed: seedData.encryptedSeedBuffer
      })

      // Call a method
      const result = await mockRpc.handlers.callMethod({
        methodName: 'getAddress',
        network: 'ethereum',
        accountIndex: 0
      })

      assert.ok(result.result, 'result should be present')
      const parsed = JSON.parse(result.result)
      assert.ok(parsed.address, 'address should be in result')
    })

    test('should reject call when WDK not initialized', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.callMethod({
          methodName: 'getAddress',
          network: 'ethereum',
          accountIndex: 0
        }),
        /WDK not initialized/
      )
    })

    test('should reject invalid method name', async () => {
      registerRpcHandlers(mockRpc, context)

      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })
      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } },
          spark: { blockchain: 'spark', config: { rpcUrl: 'https://spark.example.com' } }
        }
      }
      await mockRpc.handlers.initializeWDK({
        config: JSON.stringify(config),
        encryptionKey: seedData.encryptionKey,
        encryptedSeed: seedData.encryptedSeedBuffer
      })

      await assert.rejects(
        async () => await mockRpc.handlers.callMethod({
          methodName: 'nonExistentMethod',
          network: 'ethereum',
          accountIndex: 0
        }),
        /Method.*not found/
      )
    })

    test('should reject invalid account index', async () => {
      registerRpcHandlers(mockRpc, context)

      await assert.rejects(
        async () => await mockRpc.handlers.callMethod({
          methodName: 'getAddress',
          network: 'ethereum',
          accountIndex: -1
        }),
        /accountIndex must be a non-negative integer/
      )
    })
  })

  describe('dispose', () => {
    test('should dispose WDK instance', async () => {
      registerRpcHandlers(mockRpc, context)

      // Initialize WDK first
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const seedData = await mockRpc.handlers.getSeedAndEntropyFromMnemonic({ mnemonic })
      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } },
          spark: { blockchain: 'spark', config: { rpcUrl: 'https://spark.example.com' } }
        }
      }
      await mockRpc.handlers.initializeWDK({
        config: JSON.stringify(config),
        encryptionKey: seedData.encryptionKey,
        encryptedSeed: seedData.encryptedSeedBuffer
      })

      assert.ok(context.wdk, 'WDK should be initialized')

      // Dispose
      await mockRpc.handlers.dispose()

      assert.strictEqual(context.wdk, null, 'WDK should be disposed')
    })

    test('should handle dispose when WDK not initialized', async () => {
      registerRpcHandlers(mockRpc, context)

      // Should not throw
      await mockRpc.handlers.dispose()
      assert.strictEqual(context.wdk, null)
    })

    test('closes hosted module instances via the runtime on dispose', async () => {
      const instanceClose = mock.fn()
      context.moduleManagers = {
        addressBook: { createModule: () => ({ close: instanceClose }) }
      }
      registerRpcHandlers(mockRpc, context)

      // Construct a module (as WDK init would) so there's something to tear down.
      await context.moduleRuntime.construct('addressBook', {}, Buffer.alloc(64, 0xab))
      context.wdk = { dispose: mock.fn() }

      await mockRpc.handlers.dispose()

      assert.strictEqual(instanceClose.mock.callCount(), 1, 'module instance closed on dispose')
      assert.strictEqual(context.moduleInstances.size, 0, 'module instances cleared')
      assert.strictEqual(context.wdk, null, 'WDK disposed')
    })
  })
})
