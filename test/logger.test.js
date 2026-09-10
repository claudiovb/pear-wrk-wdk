#!/usr/bin/env node

/**
 * Unit tests for the worklet logger
 *
 * The log level is resolved once when the module loads, so every case runs the
 * logger in a child Node process with a controlled environment and asserts on
 * the exact console output.
 *
 * Run with: node --test test/logger.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const REPO_ROOT = path.join(__dirname, '..')
const LOGGER_PATH = './src/utils/logger'

/**
 * Run a script that requires the logger, in a child process with the given
 * environment. LOG_LEVEL and NODE_ENV from the parent are removed first.
 * @param {Record<string, string>} env - Environment variables to set
 * @param {string} body - Script body; `logger` is already required
 * @returns {{ stdout: string, stderr: string }} Captured output
 */
function runLogger (env, body) {
  const { LOG_LEVEL, NODE_ENV, ...inherited } = process.env
  const script = `const logger = require('${LOGGER_PATH}'); ${body}`
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: { ...inherited, ...env },
    encoding: 'utf8'
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

const LOG_ALL_LEVELS = "logger.debug('d'); logger.info('i'); logger.warn('w'); logger.error('e')"

describe('logger', () => {
  describe('log level resolution', () => {
    test('should default to ERROR when no environment is set', () => {
      const { stdout, stderr } = runLogger({}, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '')
      assert.strictEqual(stderr, '[ERROR] e\n')
    })

    test('should enable DEBUG when NODE_ENV is development', () => {
      const { stdout, stderr } = runLogger({ NODE_ENV: 'development' }, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '[DEBUG] d\n[INFO] i\n')
      assert.strictEqual(stderr, '[WARN] w\n[ERROR] e\n')
    })

    test('should enable INFO for LOG_LEVEL=info regardless of case', () => {
      const { stdout, stderr } = runLogger({ LOG_LEVEL: 'info' }, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '[INFO] i\n')
      assert.strictEqual(stderr, '[WARN] w\n[ERROR] e\n')
    })

    test('should enable WARN for LOG_LEVEL=WARN', () => {
      const { stdout, stderr } = runLogger({ LOG_LEVEL: 'WARN' }, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '')
      assert.strictEqual(stderr, '[WARN] w\n[ERROR] e\n')
    })

    test('should silence everything for LOG_LEVEL=NONE', () => {
      const { stdout, stderr } = runLogger({ LOG_LEVEL: 'NONE' }, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '')
      assert.strictEqual(stderr, '')
    })

    test('should treat a whitespace-padded LOG_LEVEL as its trimmed value', () => {
      const { stdout, stderr } = runLogger({ LOG_LEVEL: ' ERROR ' }, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '')
      assert.strictEqual(stderr, '[ERROR] e\n')
    })

    for (const value of ['production', 'off', '0', 'false', 'verbose']) {
      test(`should fall back to ERROR for unrecognized LOG_LEVEL=${value}`, () => {
        const { stdout, stderr } = runLogger({ LOG_LEVEL: value }, LOG_ALL_LEVELS)

        assert.strictEqual(stdout, '')
        assert.strictEqual(stderr, '[ERROR] e\n')
      })
    }

    test('should let LOG_LEVEL override NODE_ENV=development', () => {
      const { stdout, stderr } = runLogger({ NODE_ENV: 'development', LOG_LEVEL: 'ERROR' }, LOG_ALL_LEVELS)

      assert.strictEqual(stdout, '')
      assert.strictEqual(stderr, '[ERROR] e\n')
    })
  })

  describe('secret redaction', () => {
    const INITIALIZE_WDK_PARAMS = "{ encryptionKey: 'a2V5', encryptedSeed: 'c2VlZA==', chains: ['ethereum'] }"

    test('should redact seed encryption material at the top level of a logged object', () => {
      const { stdout } = runLogger({ LOG_LEVEL: 'INFO' }, `logger.info('JSON-RPC request: initializeWDK', ${INITIALIZE_WDK_PARAMS})`)

      assert.strictEqual(
        stdout,
        "[INFO] JSON-RPC request: initializeWDK {\n  encryptionKey: '[redacted]',\n  encryptedSeed: '[redacted]',\n  chains: [ 'ethereum' ]\n}\n"
      )
    })

    test('should redact every listed secret field in a nested object', () => {
      const payload = "{ result: { mnemonic: 'abandon', encryptedSeedBuffer: 'x', encryptedEntropy: 'y', encryptedEntropyBuffer: 'z', seed: 's', id: 7 } }"
      const { stdout } = runLogger({ LOG_LEVEL: 'INFO' }, `logger.info('response', ${payload})`)

      assert.strictEqual(
        stdout,
        "[INFO] response {\n  result: {\n    mnemonic: '[redacted]',\n    encryptedSeedBuffer: '[redacted]',\n    encryptedEntropy: '[redacted]',\n    encryptedEntropyBuffer: '[redacted]',\n    seed: '[redacted]',\n    id: 7\n  }\n}\n"
      )
    })

    test('should redact secret fields inside arrays', () => {
      const { stdout } = runLogger({ LOG_LEVEL: 'INFO' }, "logger.info('batch', [{ mnemonic: 'abandon' }, { to: '0xabc' }])")

      assert.strictEqual(stdout, "[INFO] batch [ { mnemonic: '[redacted]' }, { to: '0xabc' } ]\n")
    })

    test('should leave primitives and non-secret objects untouched', () => {
      const { stdout } = runLogger({ LOG_LEVEL: 'INFO' }, "logger.info('Args:', { to: '0xabc', value: 5 }, 42, 'text')")

      assert.strictEqual(stdout, "[INFO] Args: { to: '0xabc', value: 5 } 42 text\n")
    })

    test('should redact and stringify objects on the JSC branch', () => {
      const { stdout } = runLogger(
        { LOG_LEVEL: 'INFO' },
        `globalThis.Bare = { platform: 'ios' }; delete require.cache[require.resolve('${LOGGER_PATH}')]; const jsc = require('${LOGGER_PATH}'); jsc.info('JSON-RPC request: initializeWDK', ${INITIALIZE_WDK_PARAMS})`
      )

      assert.strictEqual(
        stdout,
        '[INFO] JSON-RPC request: initializeWDK {"encryptionKey":"[redacted]","encryptedSeed":"[redacted]","chains":["ethereum"]}\n'
      )
    })
  })

  describe('error formatting', () => {
    test('should log the stack trace of an Error on the default branch', () => {
      const { stderr } = runLogger({}, "logger.error('JSON-RPC error: initializeWDK', new Error('boom'))")

      assert.strictEqual(stderr.split('\n')[0], '[ERROR] JSON-RPC error: initializeWDK Error: boom')
    })

    test('should log the stack trace of an Error on the JSC branch instead of "{}"', () => {
      const { stderr } = runLogger(
        {},
        `globalThis.Bare = { platform: 'ios' }; delete require.cache[require.resolve('${LOGGER_PATH}')]; const jsc = require('${LOGGER_PATH}'); jsc.error('JSON-RPC error: initializeWDK', new Error('boom'))`
      )

      assert.strictEqual(stderr.split('\n')[0], '[ERROR] JSON-RPC error: initializeWDK Error: boom')
    })
  })
})
