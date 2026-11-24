#!/usr/bin/env node

/**
 * Tests for what the two main exports of the package give, required by the
 * names package.json maps: the root is what loads outside Bare (a host) and
 * ./worklet is what runs inside it. Neither brings in a transport the bundle
 * did not ask for.
 *
 * Run with: node --test test/exports.test.js
 */

require('./setup')

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

/** The folders of the package that hold the code of each transport. */
const HRPC_FOLDERS = ['generated/hrpc/', 'node_modules/hrpc/']
const BARE_RPC_FOLDERS = ['generated/bare-rpc/', 'src/bare-rpc/']

/**
 * Require some exports of the package in a new process, as a worklet would,
 * and list the files that were loaded for them.
 * @param {string[]} names - The names to require.
 * @returns {string[]} The loaded files, relative to the root of the package.
 */
function loadedFiles (names) {
  const script = `
    for (const name of ${JSON.stringify(names)}) require(name)
    console.log(JSON.stringify(Object.keys(require.cache)))
  `

  // bare-crypto is only there inside Bare, so setup.js stands in for it.
  const output = execFileSync(process.execPath, ['-r', './test/setup.js', '-e', script], { cwd: ROOT })

  return JSON.parse(output.toString()).map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
}

/**
 * Keep the files that are in one of the given folders.
 * @param {string[]} files - The files.
 * @param {string[]} folders - The folders.
 * @returns {string[]} The files in those folders.
 */
function filesIn (files, folders) {
  return files.filter((file) => folders.some((folder) => file.startsWith(folder)))
}

describe('exports', () => {
  describe('the root', () => {
    test('should export HRPC and createServerProvider and nothing else', () => {
      const root = require('@tetherto/pear-wrk-wdk')

      assert.deepStrictEqual(Object.keys(root), ['HRPC', 'createServerProvider'])
      assert.strictEqual(root.HRPC, require('@tetherto/pear-wrk-wdk/hrpc'))
      assert.strictEqual(typeof root.createServerProvider, 'function')
    })

    test('should load in a plain Node process, where bare-crypto is not available', () => {
      const output = execFileSync(process.execPath, ['-e', "console.log(Object.keys(require('@tetherto/pear-wrk-wdk')))"], { cwd: ROOT })

      assert.strictEqual(output.toString().trim(), "[ 'HRPC', 'createServerProvider' ]")
    })
  })

  describe('./worklet', () => {
    test('should export registerRpcHandlers, createStart, utils and exceptions and nothing else', () => {
      const worklet = require('@tetherto/pear-wrk-wdk/worklet')

      assert.deepStrictEqual(Object.keys(worklet), ['registerRpcHandlers', 'createStart', 'utils', 'exceptions'])
      assert.strictEqual(typeof worklet.registerRpcHandlers, 'function')
      assert.strictEqual(typeof worklet.createStart, 'function')
      assert.deepStrictEqual(Object.keys(worklet.utils), ['crypto', 'logger', 'validation'])
      assert.deepStrictEqual(Object.keys(worklet.exceptions), ['errorCodes', 'rpcException'])
    })

    test('should load no code of either transport', () => {
      const files = loadedFiles(['@tetherto/pear-wrk-wdk/worklet'])

      assert.strictEqual(files.includes('src/rpc-handlers.js'), true)
      assert.deepStrictEqual(filesIn(files, [...HRPC_FOLDERS, ...BARE_RPC_FOLDERS]), [])
    })

    test('should load no HRPC code next to the bare-rpc class', () => {
      const files = loadedFiles(['@tetherto/pear-wrk-wdk/worklet', '@tetherto/pear-wrk-wdk/bare-rpc'])

      assert.deepStrictEqual(filesIn(files, BARE_RPC_FOLDERS), ['generated/bare-rpc/index.js', 'src/bare-rpc/runtime.js'])
      assert.deepStrictEqual(filesIn(files, HRPC_FOLDERS), [])
    })

    test('should load no bare-rpc class next to the HRPC class', () => {
      const files = loadedFiles(['@tetherto/pear-wrk-wdk/worklet', '@tetherto/pear-wrk-wdk/hrpc'])

      assert.strictEqual(files.includes('generated/hrpc/index.js'), true)
      assert.deepStrictEqual(filesIn(files, BARE_RPC_FOLDERS), [])
    })
  })
})
