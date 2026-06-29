#!/usr/bin/env node

/**
 * Unit tests for JSON-RPC transport layer
 *
 * Tests framing, dispatch, JSON-RPC 2.0 compliance, and error formatting.
 * Handler business logic is already tested in rpc-handlers.test.js.
 *
 * Run with: node --test test/jsonrpc-handlers.test.js
 */

require('./setup.js')

const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')

const { registerJsonRpcHandlers } = require('../src/jsonrpc-handlers')

function createMockIpc () {
  const emitter = new EventEmitter()
  const written = []

  return {
    on: emitter.on.bind(emitter),
    write: (buf) => written.push(buf),
    emit: emitter.emit.bind(emitter),
    getWritten: () => written,
    getLastResponse: () => {
      if (written.length === 0) return null
      const buf = written[written.length - 1]
      const msgLen = buf.readUInt32BE(0)
      const body = buf.slice(4, 4 + msgLen).toString()
      return JSON.parse(body)
    },
    getAllResponses: () => {
      return written.map((buf) => {
        const msgLen = buf.readUInt32BE(0)
        const body = buf.slice(4, 4 + msgLen).toString()
        return JSON.parse(body)
      })
    }
  }
}

function frameMessage (obj) {
  const payload = Buffer.from(JSON.stringify(obj))
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, payload])
}

function createContext () {
  return {
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

      dispose (blockchains) {
        if (Array.isArray(blockchains) && blockchains.length > 0) {
          for (const network of blockchains) {
            delete this.wallets[network]
          }
        } else {
          this.wallets = {}
        }
      }
    },
    walletManagers: {
      ethereum: { name: 'EthereumManager' },
      spark: { name: 'SparkManager' }
    },
    protocolManagers: {},
    wdkLoadError: null
  }
}

async function waitForResponse (ipc, expectedCount) {
  const start = Date.now()
  while (ipc.getWritten().length < expectedCount) {
    if (Date.now() - start > 5000) throw new Error('Timed out waiting for response')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('JSON-RPC Transport', () => {
  let ipc, context

  beforeEach(() => {
    ipc = createMockIpc()
    context = createContext()
    registerJsonRpcHandlers(ipc, context)
  })

  describe('framing', () => {
    test('should decode length-prefixed frame and produce length-prefixed response', async () => {
      const msg = frameMessage({ jsonrpc: '2.0', id: 1, method: 'workletStart', params: {} })
      ipc.emit('data', msg)
      await waitForResponse(ipc, 1)

      const raw = ipc.getWritten()[0]
      const reportedLen = raw.readUInt32BE(0)
      assert.strictEqual(raw.length, 4 + reportedLen, 'response frame length should match header')
    })

    test('should handle chunked data across multiple emit calls', async () => {
      const msg = frameMessage({ jsonrpc: '2.0', id: 2, method: 'workletStart', params: {} })
      const mid = Math.floor(msg.length / 2)
      ipc.emit('data', msg.slice(0, mid))
      ipc.emit('data', msg.slice(mid))

      await waitForResponse(ipc, 1)
      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.id, 2)
      assert.strictEqual(resp.result.status, 'started')
    })

    test('should handle multiple messages in a single chunk', async () => {
      const msg1 = frameMessage({ jsonrpc: '2.0', id: 10, method: 'workletStart', params: {} })
      const msg2 = frameMessage({ jsonrpc: '2.0', id: 11, method: 'workletStart', params: {} })
      ipc.emit('data', Buffer.concat([msg1, msg2]))

      await waitForResponse(ipc, 2)
      const responses = ipc.getAllResponses()
      assert.strictEqual(responses[0].id, 10)
      assert.strictEqual(responses[1].id, 11)
    })

    test('should ignore non-JSON-RPC messages', async () => {
      const msg = frameMessage({ id: 1, method: 'workletStart', params: {} })
      ipc.emit('data', msg)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.strictEqual(ipc.getWritten().length, 0)
    })
  })

  describe('JSON-RPC 2.0 compliance', () => {
    test('should echo back the request id', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 42, method: 'workletStart', params: {} }))
      await waitForResponse(ipc, 1)
      assert.strictEqual(ipc.getLastResponse().id, 42)
    })

    test('should include jsonrpc 2.0 in response', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'workletStart', params: {} }))
      await waitForResponse(ipc, 1)
      assert.strictEqual(ipc.getLastResponse().jsonrpc, '2.0')
    })

    test('should include result for successful calls', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'workletStart', params: {} }))
      await waitForResponse(ipc, 1)
      const resp = ipc.getLastResponse()
      assert.ok(resp.result, 'successful response should have result')
      assert.strictEqual(resp.error, undefined, 'successful response should not have error')
    })
  })

  describe('method dispatch', () => {
    test('workletStart returns started status', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'workletStart', params: {} }))
      await waitForResponse(ipc, 1)
      assert.strictEqual(ipc.getLastResponse().result.status, 'started')
    })

    test('generateEntropyAndEncrypt returns encrypted data', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'generateEntropyAndEncrypt', params: { wordCount: 12 } }))
      await waitForResponse(ipc, 1)

      const resp = ipc.getLastResponse()
      assert.ok(resp.result.encryptionKey)
      assert.ok(resp.result.encryptedSeedBuffer)
      assert.ok(resp.result.encryptedEntropyBuffer)
    })

    test('getMnemonicFromEntropy returns mnemonic', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'generateEntropyAndEncrypt', params: { wordCount: 12 } }))
      await waitForResponse(ipc, 1)
      const genResult = ipc.getLastResponse().result

      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'getMnemonicFromEntropy',
        params: {
          encryptedEntropy: genResult.encryptedEntropyBuffer,
          encryptionKey: genResult.encryptionKey
        }
      }))
      await waitForResponse(ipc, 2)

      const resp = ipc.getLastResponse()
      assert.ok(resp.result.mnemonic)
      const words = resp.result.mnemonic.split(' ')
      assert.strictEqual(words.length, 12)
    })

    test('getSeedAndEntropyFromMnemonic returns encrypted data', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'getSeedAndEntropyFromMnemonic', params: { mnemonic } }))
      await waitForResponse(ipc, 1)

      const resp = ipc.getLastResponse()
      assert.ok(resp.result.encryptionKey)
      assert.ok(resp.result.encryptedSeedBuffer)
      assert.ok(resp.result.encryptedEntropyBuffer)
    })

    test('initializeWDK initializes the WDK instance', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'getSeedAndEntropyFromMnemonic', params: { mnemonic } }))
      await waitForResponse(ipc, 1)
      const seedData = ipc.getLastResponse().result

      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } }
        }
      }
      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'initializeWDK',
        params: {
          config: JSON.stringify(config),
          encryptionKey: seedData.encryptionKey,
          encryptedSeed: seedData.encryptedSeedBuffer
        }
      }))
      await waitForResponse(ipc, 2)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.result.status, 'initialized')
      assert.ok(context.wdk, 'context.wdk should be set')
    })

    test('callMethod dispatches to WDK account method', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'getSeedAndEntropyFromMnemonic', params: { mnemonic } }))
      await waitForResponse(ipc, 1)
      const seedData = ipc.getLastResponse().result

      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } }
        }
      }
      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'initializeWDK',
        params: {
          config: JSON.stringify(config),
          encryptionKey: seedData.encryptionKey,
          encryptedSeed: seedData.encryptedSeedBuffer
        }
      }))
      await waitForResponse(ipc, 2)

      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'callMethod',
        params: { methodName: 'getAddress', network: 'ethereum', accountIndex: 0 }
      }))
      await waitForResponse(ipc, 3)

      const resp = ipc.getLastResponse()
      assert.ok(resp.result.result)
      assert.ok(resp.result.result.address)
    })

    test('dispose clears WDK instance', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'getSeedAndEntropyFromMnemonic', params: { mnemonic } }))
      await waitForResponse(ipc, 1)
      const seedData = ipc.getLastResponse().result

      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } }
        }
      }
      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'initializeWDK',
        params: {
          config: JSON.stringify(config),
          encryptionKey: seedData.encryptionKey,
          encryptedSeed: seedData.encryptedSeedBuffer
        }
      }))
      await waitForResponse(ipc, 2)
      assert.ok(context.wdk)

      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 3, method: 'dispose', params: {} }))
      await waitForResponse(ipc, 3)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.result.status, 'disposed')
      assert.strictEqual(context.wdk, null)
    })

    async function initTwoChainWdk () {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'getSeedAndEntropyFromMnemonic', params: { mnemonic } }))
      await waitForResponse(ipc, 1)
      const seedData = ipc.getLastResponse().result

      const config = {
        networks: {
          ethereum: { blockchain: 'ethereum', config: { rpcUrl: 'https://eth.example.com' } },
          spark: { blockchain: 'spark', config: { rpcUrl: 'https://spark.example.com' } }
        }
      }
      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'initializeWDK',
        params: {
          config: JSON.stringify(config),
          encryptionKey: seedData.encryptionKey,
          encryptedSeed: seedData.encryptedSeedBuffer
        }
      }))
      await waitForResponse(ipc, 2)
      assert.ok(context.wdk)
      assert.deepStrictEqual(Object.keys(context.wdk.wallets).sort(), ['ethereum', 'spark'])
    }

    test('dispose with no params disposes all wallets and nulls the WDK instance', async () => {
      await initTwoChainWdk()

      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 3, method: 'dispose', params: {} }))
      await waitForResponse(ipc, 3)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.result.status, 'disposed')
      assert.strictEqual(context.wdk, null, 'full dispose should null the WDK instance')
    })

    test('dispose with a single blockchain disposes only that wallet and keeps the instance alive', async () => {
      await initTwoChainWdk()
      const wdk = context.wdk

      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 3, method: 'dispose', params: { blockchains: ['ethereum'] } }))
      await waitForResponse(ipc, 3)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.result.status, 'disposed')
      assert.strictEqual(context.wdk, wdk, 'targeted dispose should keep the WDK instance alive')
      assert.deepStrictEqual(Object.keys(context.wdk.wallets), ['spark'], 'only the targeted wallet should be removed')
    })

    test('dispose with an empty blockchains array disposes everything (treated as full dispose)', async () => {
      await initTwoChainWdk()

      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 3, method: 'dispose', params: { blockchains: [] } }))
      await waitForResponse(ipc, 3)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.result.status, 'disposed')
      assert.strictEqual(context.wdk, null, 'empty array should behave like a full dispose')
    })
  })

  describe('error formatting', () => {
    test('unknown method returns error with INTERNAL_ERROR code', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 99, method: 'nonExistent', params: {} }))
      await waitForResponse(ipc, 1)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.id, 99)
      assert.ok(resp.error, 'should have error field')
      assert.strictEqual(resp.error.code, 'INTERNAL_ERROR')
      assert.ok(resp.error.message.includes('Unknown method'))
    })

    test('structured handler error preserves code and message', async () => {
      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'generateEntropyAndEncrypt',
        params: { wordCount: 15 }
      }))
      await waitForResponse(ipc, 1)

      const resp = ipc.getLastResponse()
      assert.ok(resp.error)
      assert.ok(resp.error.code)
      assert.ok(resp.error.message)
    })

    test('callMethod without WDK returns structured error', async () => {
      ipc.emit('data', frameMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'callMethod',
        params: { methodName: 'getAddress', network: 'ethereum', accountIndex: 0 }
      }))
      await waitForResponse(ipc, 1)

      const resp = ipc.getLastResponse()
      assert.ok(resp.error)
      assert.ok(resp.error.message.includes('WDK not initialized'))
    })

    test('error response includes jsonrpc 2.0 and correct id', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 77, method: 'nonExistent', params: {} }))
      await waitForResponse(ipc, 1)

      const resp = ipc.getLastResponse()
      assert.strictEqual(resp.jsonrpc, '2.0')
      assert.strictEqual(resp.id, 77)
    })
  })

  describe('duplicate request ID protection', () => {
    test('should reject a duplicate concurrent request id', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'getSeedAndEntropyFromMnemonic', params: { mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' } }))
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 1, method: 'workletStart', params: {} }))

      await waitForResponse(ipc, 2)
      const responses = ipc.getAllResponses()

      const successResp = responses.find((r) => r.result)
      const errorResp = responses.find((r) => r.error)

      assert.ok(successResp, 'first request should succeed')
      assert.ok(errorResp, 'duplicate request should return error')
      assert.strictEqual(errorResp.error.code, 'DUPLICATE_REQUEST')
      assert.ok(errorResp.error.message.includes('already being processed'))
    })

    test('should allow reuse of an id after the previous request completes', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 5, method: 'workletStart', params: {} }))
      await waitForResponse(ipc, 1)

      const first = ipc.getLastResponse()
      assert.strictEqual(first.id, 5)
      assert.ok(first.result)

      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 5, method: 'workletStart', params: {} }))
      await waitForResponse(ipc, 2)

      const responses = ipc.getAllResponses()
      assert.strictEqual(responses.length, 2)
      assert.ok(responses[1].result, 'reused id should succeed after previous request completed')
      assert.strictEqual(responses[1].id, 5)
    })

    test('should allow different ids to be processed concurrently', async () => {
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 20, method: 'workletStart', params: {} }))
      ipc.emit('data', frameMessage({ jsonrpc: '2.0', id: 21, method: 'workletStart', params: {} }))

      await waitForResponse(ipc, 2)
      const responses = ipc.getAllResponses()

      assert.strictEqual(responses.length, 2)
      assert.ok(responses[0].result, 'first concurrent request should succeed')
      assert.ok(responses[1].result, 'second concurrent request should succeed')

      const ids = responses.map((r) => r.id).sort()
      assert.deepStrictEqual(ids, [20, 21])
    })
  })
})
