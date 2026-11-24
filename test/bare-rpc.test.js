#!/usr/bin/env node

/**
 * Tests for what is specific to the bare-rpc transport: the JSON payloads,
 * the buffer fields, the frame limit, and that nothing a peer sends or a
 * handler throws ends the worklet. What the two transports have in common is
 * in transports.test.js.
 *
 * The host side of most cases is a plain bare-rpc session, as a Swift or a
 * Kotlin host would have, so the cases assert the bytes that really cross.
 *
 * Run with: node --test test/bare-rpc.test.js
 */

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const { once } = require('node:events')
const path = require('node:path')

const RPC = require('bare-rpc')

const BareRPC = require('../generated/bare-rpc')
const { createPipePair } = require('./helpers/pipe-pair')

// The ids of the commands used below, as src/hrpc/hrpc.json assigns them.
const LOG = 0
const GENERATE_ENTROPY_AND_ENCRYPT = 4
const INITIALIZE_WDK = 6
const CALL_METHOD = 3
const PING = 13

const ENCRYPTION_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex')

const ENCRYPTED_SEED = Buffer.from('a1a2a3a4a5a6a7a8', 'hex')

/**
 * Send a request with a raw payload and wait for the raw payload of its response.
 * @param {RPC} rpc - The session of the host.
 * @param {number} command - The id of the command.
 * @param {string} [payload] - The payload, as text. Nothing is sent when it is left out.
 * @returns {Promise<string>} The payload of the response, as text.
 */
async function request (rpc, command, payload) {
  const req = rpc.request(command)

  req.send(payload === undefined ? null : Buffer.from(payload))

  return Buffer.from(await req.reply() ?? []).toString()
}

/**
 * Let the timers and the microtasks that are already queued run, so that an
 * exception thrown outside of any promise has had the time to surface.
 * @returns {Promise<void>}
 */
function settle () {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('BareRPC', () => {
  let rpc
  let worklet
  let workletStream
  let uncaught

  const onUncaught = (error) => uncaught.push(error)

  beforeEach(() => {
    let hostStream
    ;[hostStream, workletStream] = createPipePair()

    worklet = new BareRPC(workletStream)
    rpc = new RPC(hostStream)

    uncaught = []
    process.on('uncaughtException', onUncaught)
  })

  afterEach(() => {
    process.off('uncaughtException', onUncaught)
  })

  describe('payloads', () => {
    test('should give the handler the buffer fields of a request as Buffers', async () => {
      let received
      worklet.onInitializeWDK(async (init) => {
        received = init

        return { status: 'initialized' }
      })

      const response = await request(rpc, INITIALIZE_WDK, JSON.stringify({
        encryptionKey: ENCRYPTION_KEY.toString('base64'),
        encryptedSeed: ENCRYPTED_SEED.toString('base64'),
        config: '{"networks":{}}'
      }))

      assert.strictEqual(response, '{"status":"initialized"}')
      assert.deepStrictEqual(received, {
        encryptionKey: ENCRYPTION_KEY,
        encryptedSeed: ENCRYPTED_SEED,
        config: '{"networks":{}}'
      })
    })

    test('should send the buffer fields of a response as base64 strings and then zero them', async () => {
      const secrets = {
        encryptionKey: Buffer.from(ENCRYPTION_KEY),
        encryptedSeedBuffer: Buffer.from(ENCRYPTED_SEED),
        encryptedEntropyBuffer: Buffer.from('b1b2b3b4', 'hex')
      }
      worklet.onGenerateEntropyAndEncrypt(async () => secrets)

      const response = await request(rpc, GENERATE_ENTROPY_AND_ENCRYPT, '{"wordCount":12}')

      assert.deepStrictEqual(JSON.parse(response), {
        encryptionKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
        encryptedSeedBuffer: 'oaKjpKWmp6g=',
        encryptedEntropyBuffer: 'sbKztA=='
      })
      assert.deepStrictEqual(secrets, {
        encryptionKey: Buffer.alloc(32),
        encryptedSeedBuffer: Buffer.alloc(8),
        encryptedEntropyBuffer: Buffer.alloc(4)
      })
    })

    test('should give the caller the buffer fields of a response as Buffers', async () => {
      const [hostStream, otherStream] = createPipePair()
      const host = new BareRPC(hostStream)
      new BareRPC(otherStream).onGenerateEntropyAndEncrypt(async () => ({
        encryptionKey: Buffer.from(ENCRYPTION_KEY),
        encryptedSeedBuffer: Buffer.from(ENCRYPTED_SEED),
        encryptedEntropyBuffer: Buffer.from('b1b2b3b4', 'hex')
      }))

      const result = await host.generateEntropyAndEncrypt({ wordCount: 12 })

      assert.deepStrictEqual(result, {
        encryptionKey: ENCRYPTION_KEY,
        encryptedSeedBuffer: ENCRYPTED_SEED,
        encryptedEntropyBuffer: Buffer.from('b1b2b3b4', 'hex')
      })
    })

    test('should give the handler null when the request has no payload', async () => {
      const received = []
      worklet.onPing(async (ping) => {
        received.push(ping)

        return {}
      })

      const response = await request(rpc, PING)

      assert.strictEqual(response, '{}')
      assert.deepStrictEqual(received, [null])
    })

    test('should answer with BAD_REQUEST when the payload is not valid JSON, and keep answering', async () => {
      worklet.onPing(async () => ({}))

      const call = request(rpc, PING, '{"mnemonic": "abandon aband')

      await assert.rejects(call, (error) => {
        assert.strictEqual(error.code, 'BAD_REQUEST')
        assert.deepStrictEqual(JSON.parse(error.message), {
          code: 'BAD_REQUEST',
          name: 'Error',
          message: 'Payload is not valid JSON'
        })
        return true
      })
      assert.strictEqual(await request(rpc, PING), '{}')
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })
  })

  describe('commands', () => {
    test('should answer with UNKNOWN_COMMAND when no command has the id, and keep answering', async () => {
      worklet.onPing(async () => ({}))

      const call = request(rpc, 99)

      await assert.rejects(call, (error) => {
        assert.strictEqual(error.code, 'UNKNOWN_COMMAND')
        assert.strictEqual(error.message, 'UNKNOWN_COMMAND: Unknown command 99')
        return true
      })
      assert.strictEqual(await request(rpc, PING), '{}')
    })

    test('should ignore an event that has no handler', async () => {
      worklet.onPing(async () => ({}))

      rpc.event(LOG).send(Buffer.from('{"type":1,"data":"hello"}'))

      assert.strictEqual(await request(rpc, PING), '{}')
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })
  })

  describe('errors a handler cannot be allowed to end the worklet with', () => {
    // bare-rpc rethrows these three as uncaught exceptions instead of answering.
    for (const ErrorType of [TypeError, SyntaxError, RangeError]) {
      test(`should answer with INTERNAL_ERROR when a handler throws a ${ErrorType.name}, and keep answering`, async () => {
        worklet.onCallMethod(async () => { throw new ErrorType('Unexpected failure') })
        worklet.onPing(async () => ({}))

        const call = request(rpc, CALL_METHOD, '{"methodName":"getAddress"}')

        await assert.rejects(call, (error) => {
          assert.strictEqual(error.code, 'INTERNAL_ERROR')
          assert.deepStrictEqual(JSON.parse(error.message), {
            code: 'INTERNAL_ERROR',
            name: ErrorType.name,
            message: 'Unexpected failure'
          })
          return true
        })
        assert.strictEqual(await request(rpc, PING), '{}')
        await settle()
        assert.deepStrictEqual(uncaught, [])
      })
    }

    test('should answer with INTERNAL_ERROR when a handler throws a value that is not an error', async () => {
      worklet.onCallMethod(async () => { throw null }) // eslint-disable-line no-throw-literal

      const call = request(rpc, CALL_METHOD, '{"methodName":"getAddress"}')

      await assert.rejects(call, (error) => {
        assert.strictEqual(error.code, 'INTERNAL_ERROR')
        assert.deepStrictEqual(JSON.parse(error.message), { code: 'INTERNAL_ERROR', name: 'Error', message: 'null' })
        return true
      })
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })

    test('should answer with INTERNAL_ERROR when a handler throws an error that cannot be described', async () => {
      worklet.onCallMethod(async () => {
        const error = new Error('Unexpected failure')
        Object.defineProperty(error, 'reason', { enumerable: true, get () { throw new TypeError('Cannot read the reason') } })

        throw error
      })

      const call = request(rpc, CALL_METHOD, '{"methodName":"getAddress"}')

      await assert.rejects(call, (error) => {
        assert.strictEqual(error.code, 'INTERNAL_ERROR')
        assert.deepStrictEqual(JSON.parse(error.message), {
          code: 'INTERNAL_ERROR',
          name: 'Error',
          message: 'The error could not be described'
        })
        return true
      })
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })

    test('should answer with INTERNAL_ERROR when the response cannot be written as JSON, and keep answering', async () => {
      worklet.onCallMethod(async () => ({ result: 10n }))
      worklet.onPing(async () => ({}))

      const call = request(rpc, CALL_METHOD, '{"methodName":"getBalance"}')

      await assert.rejects(call, (error) => {
        assert.strictEqual(error.code, 'INTERNAL_ERROR')
        assert.deepStrictEqual(JSON.parse(error.message), {
          code: 'INTERNAL_ERROR',
          name: 'Error',
          message: 'Message cannot be written as JSON',
          causes: [{ name: 'TypeError', message: 'Do not know how to serialize a BigInt' }]
        })
        return true
      })
      assert.strictEqual(await request(rpc, PING), '{}')
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })

    test('should zero the buffer fields of a response that cannot be written as JSON', async () => {
      const secrets = { encryptionKey: Buffer.from(ENCRYPTION_KEY), encryptedSeedBuffer: 10n }
      worklet.onGenerateEntropyAndEncrypt(async () => secrets)

      await assert.rejects(request(rpc, GENERATE_ENTROPY_AND_ENCRYPT, '{"wordCount":12}'))

      assert.deepStrictEqual(secrets.encryptionKey, Buffer.alloc(32))
    })

    test('should keep the session when the handler of an event throws', async () => {
      const [hostStream, otherStream] = createPipePair()
      const host = new BareRPC(hostStream)
      const other = new BareRPC(otherStream)
      host.onLog(async () => { throw new TypeError('Unexpected failure') })
      other.onPing(async () => ({}))

      other.log({ type: 1, data: 'hello' })

      assert.deepStrictEqual(await host.ping(), {})
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })

    test('should keep the session when a command is sent as an event and its handler throws', async () => {
      worklet.onCallMethod(async () => { throw new TypeError('Unexpected failure') })
      worklet.onPing(async () => ({}))

      rpc.event(CALL_METHOD).send(Buffer.from('{"methodName":"getAddress"}'))

      assert.strictEqual(await request(rpc, PING), '{}')
      await settle()
      assert.deepStrictEqual(uncaught, [])
    })
  })

  describe('frame limit', () => {
    test('should default to 16 MiB for a frame and for the bytes a stream may buffer', () => {
      assert.strictEqual(BareRPC.DEFAULT_MAX_FRAME_SIZE, 16777216)
      assert.strictEqual(BareRPC.DEFAULT_MAX_BUFFERED_BYTES, 16777216)
    })

    test('should fail the session when a frame is larger than maxFrameSize', async () => {
      const [hostStream, limitedStream] = createPipePair()
      const limited = new BareRPC(limitedStream, { maxFrameSize: 64 })
      limited.onCallMethod(async () => ({ result: 'null' }))
      const failed = once(limitedStream, 'error')

      new RPC(hostStream).request(CALL_METHOD).send(Buffer.from(JSON.stringify({ args: 'a'.repeat(128) })))

      const [error] = await failed
      assert.strictEqual(error.code, 'FRAME_TOO_LARGE')
      assert.strictEqual(error.message, 'FRAME_TOO_LARGE: Frame of 148 bytes exceeds the limit of 64 bytes')
    })

    test('should answer a frame that is within maxFrameSize', async () => {
      const [hostStream, limitedStream] = createPipePair()
      const limited = new BareRPC(limitedStream, { maxFrameSize: 64 })
      limited.onPing(async () => ({}))

      const response = await request(new RPC(hostStream), PING, '{}')

      assert.strictEqual(response, '{}')
    })
  })

  describe('outside Bare', () => {
    test('should load in a plain Node process, where bare-crypto is not available', () => {
      const root = path.join(__dirname, '..')

      const output = execFileSync(process.execPath, ['-e', "console.log(typeof require('./generated/bare-rpc'))"], { cwd: root })

      assert.strictEqual(output.toString().trim(), 'function')
    })
  })
})
