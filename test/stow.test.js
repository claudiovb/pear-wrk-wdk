#!/usr/bin/env node

/**
 * Tests for the bare-stow server providers: createServerProvider(transport)
 * gives what bare-stow takes as its `server` option, and the module it
 * generates attaches the class of that transport to the IPC of the worklet.
 *
 * bare-stow packs the generated module next to the entry of the bundle, in a
 * project that depends on this package. Here it is written into a folder
 * that depends on this package through a link, and loaded from there.
 *
 * Run with: node --test test/stow.test.js
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RPC = require('bare-rpc')

const { createServerProvider } = require('@tetherto/pear-wrk-wdk')
const HRPC = require('@tetherto/pear-wrk-wdk/hrpc')
const BareRPC = require('@tetherto/pear-wrk-wdk/bare-rpc')
const { createPipePair } = require('./helpers/pipe-pair')

const ROOT = path.join(__dirname, '..')

// The id of the command used below, as src/hrpc/hrpc.json assigns it.
const CALL_METHOD = 3

describe('createServerProvider', () => {
  let project
  let loaded = 0

  before(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'pear-wrk-wdk-stow-'))

    fs.mkdirSync(path.join(project, 'node_modules', '@tetherto'), { recursive: true })
    fs.symlinkSync(ROOT, path.join(project, 'node_modules', '@tetherto', 'pear-wrk-wdk'), 'dir')
  })

  after(() => {
    fs.rmSync(project, { recursive: true, force: true })
  })

  /**
   * Write a generated module into the project and load it. Each one gets a
   * file of its own: a module is loaded once for a given file.
   * @param {string} source - The source of the module.
   * @param {'esm' | 'cjs'} moduleSystem - The module system it is written in.
   * @returns {Promise<{ attach: (ipc: object) => object }>} What the module exports.
   */
  async function load (source, moduleSystem) {
    const file = path.join(project, `__server__${loaded++}.${moduleSystem === 'esm' ? 'mjs' : 'cjs'}`)

    fs.writeFileSync(file, source)

    return moduleSystem === 'esm' ? await import(pathToFileURL(file)) : require(file)
  }

  describe('bare-rpc', () => {
    test('should be an RPC library of bare-stow for JavaScript, named after the export of its class', () => {
      const provider = createServerProvider('bare-rpc')

      assert.strictEqual(provider.name, '@tetherto/pear-wrk-wdk/bare-rpc')
      assert.deepStrictEqual(Object.keys(provider.languages), ['javascript'])
    })

    test('should generate a CommonJS module that attaches a BareRPC to the IPC', async () => {
      const provider = createServerProvider('bare-rpc')
      const [ipc] = createPipePair()

      const { source } = provider.languages.javascript.generate({ role: 'server', options: { module: 'cjs' } })
      const { attach } = await load(source, 'cjs')
      const rpc = attach(ipc)

      assert.strictEqual(source, [
        "const BareRPC = require('@tetherto/pear-wrk-wdk/bare-rpc')",
        '',
        'exports.attach = function attach (ipc) {',
        '  return new BareRPC(ipc)',
        '}',
        ''
      ].join('\n'))
      assert.strictEqual(rpc instanceof BareRPC, true)
    })

    test('should generate an ES module that attaches a BareRPC to the IPC', async () => {
      const provider = createServerProvider('bare-rpc')
      const [ipc] = createPipePair()

      const { source } = provider.languages.javascript.generate({ role: 'server', options: { module: 'esm' } })
      const { attach } = await load(source, 'esm')
      const rpc = attach(ipc)

      assert.strictEqual(source, [
        "import BareRPC from '@tetherto/pear-wrk-wdk/bare-rpc'",
        '',
        'export function attach (ipc) {',
        '  return new BareRPC(ipc)',
        '}',
        ''
      ].join('\n'))
      assert.strictEqual(rpc instanceof BareRPC, true)
    })

    test('should give the limits to the session of the generated module', async () => {
      const provider = createServerProvider('bare-rpc', { maxFrameSize: 64, maxBufferedBytes: 1024 })
      const [hostStream, ipc] = createPipePair()

      const { source } = provider.languages.javascript.generate({ role: 'server', options: { module: 'cjs' } })
      const { attach } = await load(source, 'cjs')
      attach(ipc).onCallMethod(async () => ({ result: 'null' }))
      const failed = once(ipc, 'error')
      new RPC(hostStream).request(CALL_METHOD).send(Buffer.from(JSON.stringify({ args: 'a'.repeat(128) })))
      const [error] = await failed

      assert.strictEqual(source, [
        "const BareRPC = require('@tetherto/pear-wrk-wdk/bare-rpc')",
        '',
        'exports.attach = function attach (ipc) {',
        '  return new BareRPC(ipc, {"maxFrameSize":64,"maxBufferedBytes":1024})',
        '}',
        ''
      ].join('\n'))
      assert.strictEqual(error.message, 'FRAME_TOO_LARGE: Frame of 148 bytes exceeds the limit of 64 bytes')
    })

    test('should throw when asked to generate for the client role', () => {
      const provider = createServerProvider('bare-rpc')

      assert.throws(
        () => provider.languages.javascript.generate({ role: 'client', options: { module: 'esm' } }),
        { message: '@tetherto/pear-wrk-wdk/bare-rpc is a server provider: it generates nothing for the client role' }
      )
    })
  })

  describe('hrpc', () => {
    test('should be an RPC library of bare-stow for JavaScript, named after the export of its class', () => {
      const provider = createServerProvider('hrpc')

      assert.strictEqual(provider.name, '@tetherto/pear-wrk-wdk/hrpc')
      assert.deepStrictEqual(Object.keys(provider.languages), ['javascript'])
    })

    test('should generate a CommonJS module that attaches an HRPC to the IPC', async () => {
      const provider = createServerProvider('hrpc')
      const [ipc] = createPipePair()

      const { source } = provider.languages.javascript.generate({ role: 'server', options: { module: 'cjs' } })
      const { attach } = await load(source, 'cjs')
      const rpc = attach(ipc)

      assert.strictEqual(source, [
        "const HRPC = require('@tetherto/pear-wrk-wdk/hrpc')",
        '',
        'exports.attach = function attach (ipc) {',
        '  return new HRPC(ipc)',
        '}',
        ''
      ].join('\n'))
      assert.strictEqual(rpc instanceof HRPC, true)
    })

    test('should generate an ES module that attaches an HRPC to the IPC', async () => {
      const provider = createServerProvider('hrpc')
      const [ipc] = createPipePair()

      const { source } = provider.languages.javascript.generate({ role: 'server', options: { module: 'esm' } })
      const { attach } = await load(source, 'esm')
      const rpc = attach(ipc)

      assert.strictEqual(source, [
        "import HRPC from '@tetherto/pear-wrk-wdk/hrpc'",
        '',
        'export function attach (ipc) {',
        '  return new HRPC(ipc)',
        '}',
        ''
      ].join('\n'))
      assert.strictEqual(rpc instanceof HRPC, true)
    })

    test('should throw when asked to generate for the client role', () => {
      const provider = createServerProvider('hrpc')

      assert.throws(
        () => provider.languages.javascript.generate({ role: 'client', options: { module: 'esm' } }),
        { message: '@tetherto/pear-wrk-wdk/hrpc is a server provider: it generates nothing for the client role' }
      )
    })
  })
})
