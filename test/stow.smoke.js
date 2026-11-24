#!/usr/bin/env node

/**
 * Smoke test of the worklet under Bare, packed and started by bare-stow.
 *
 * This file runs in Node and plays the host. The worklet runs in Bare: for
 * each transport, the entry in test/fixtures/stow is packed with the server
 * provider of that transport and started as a separate Bare process through
 * the harness bare-stow generates. The cases call it over the IPC between
 * the two processes, with the class of the transport. It is the only test
 * that runs the code of the worklet under Bare, with the real bare-crypto,
 * and not under Node.
 *
 * Why the bare-sidecar target, when the apps use bare-kit: bare-stow only
 * generates the harness of bare-kit for Swift and Kotlin, and bare-sidecar
 * is the target a host in Node can start. What is tested is the same on
 * every target: the entry, the module of the server provider, the handlers
 * and stop. Running in a bare-kit worklet is covered where the Swift and
 * Kotlin packages are built (wdk-worklet-bundler and the cores).
 *
 * It is not part of `npm test`: it starts processes and takes seconds. The
 * build workflow runs both.
 *
 * Run with: npm run test:stow
 */

const { test, describe, before, afterEach } = require('node:test')
const assert = require('node:assert')
const { once } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const stow = require('bare-stow')
const Sidecar = require('bare-sidecar')

const { createServerProvider } = require('@tetherto/pear-wrk-wdk')
const HRPC = require('@tetherto/pear-wrk-wdk/hrpc')
const BareRPC = require('@tetherto/pear-wrk-wdk/bare-rpc')

const TRANSPORTS = [
  ['hrpc', HRPC],
  ['bare-rpc', BareRPC]
]

const FIXTURE = path.join(__dirname, 'fixtures', 'stow')

// The triple bare-stow names the machine running the test by, such as darwin-arm64.
const HOST = `${process.platform}-${process.arch}`

// How long the worklet gets to report that it is ready, in milliseconds.
const READY_TIMEOUT = 30000

const TEST_TIMEOUT = 60000

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const CONFIG = JSON.stringify({
  networks: {
    bitcoin: { blockchain: 'bitcoin', config: { host: 'electrum.example.com' } }
  }
})

// What the WDK of the fixture writes to the output of the worklet when it is disposed.
const DISPOSED = 'fixture: WDK disposed'

for (const [transport, Transport] of TRANSPORTS) {
  describe(`worklet packed by bare-stow, serving ${transport}`, () => {
    const out = path.join(FIXTURE, 'out', transport)

    let sidecar
    let output

    before(async () => {
      fs.rmSync(out, { recursive: true, force: true })

      const artifacts = stow(pathToFileURL(path.join(FIXTURE, 'entry.js')), 'bare-sidecar', pathToFileURL(out + path.sep), {
        server: createServerProvider(transport),
        languageOptions: { module: 'cjs' },
        hosts: [HOST]
      })

      // The files are written as the generator is read.
      let artifact
      do { artifact = await artifacts.next() } while (!artifact.done)
    })

    afterEach(() => {
      // Only still running when a case failed before it terminated the worklet.
      if (sidecar) sidecar.kill('SIGKILL')
    })

    /**
     * Start the packed worklet through the harness bare-stow generated.
     * @returns {Promise<{ rpc: object, ipc: object }>} The host side of the transport, and the
     *   IPC of bare-stow under it.
     */
    async function start () {
      const harness = require(out)

      sidecar = new Sidecar(path.join(out, 'index.bundle'), { stdio: ['ignore', 'pipe', 'inherit'] })

      output = ''
      sidecar.stdout.on('data', (data) => { output += data })

      const { ipc } = await harness.connect(sidecar, { timeout: READY_TIMEOUT })

      return { rpc: new Transport(ipc), ipc }
    }

    /**
     * Terminate the worklet and wait for all of its output.
     * @param {object} ipc - The IPC of bare-stow.
     * @returns {Promise<{ exitCode: number, disposals: string[] }>} The exit code of the worklet
     *   and the lines its WDK wrote when it was disposed.
     */
    async function terminate (ipc) {
      const closed = once(sidecar.stdout, 'close')

      const exitCode = await ipc.terminate()
      await closed

      return { exitCode, disposals: output.split('\n').filter((line) => line === DISPOSED) }
    }

    test('should answer the commands of a session and exit with code 0', { timeout: TEST_TIMEOUT }, async () => {
      const { rpc, ipc } = await start()

      const started = await rpc.workletStart()
      const { encryptionKey, encryptedSeedBuffer } = await rpc.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })
      const initialized = await rpc.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })
      const called = await rpc.callMethod({ methodName: 'getAddress', network: 'bitcoin', accountIndex: 2 })
      const disposed = await rpc.dispose({})
      const { exitCode, disposals } = await terminate(ipc)

      assert.deepStrictEqual(started, { status: 'started' })
      assert.deepStrictEqual(initialized, { status: 'initialized' })
      assert.deepStrictEqual(called, { result: '"bitcoin:2"' })
      assert.deepStrictEqual(disposed, { status: 'disposed' })
      assert.strictEqual(exitCode, 0)
      assert.deepStrictEqual(disposals, [DISPOSED])
    })

    test('should dispose the WDK when the host terminates the worklet, and exit with code 0', { timeout: TEST_TIMEOUT }, async () => {
      const { rpc, ipc } = await start()
      const { encryptionKey, encryptedSeedBuffer } = await rpc.getSeedAndEntropyFromMnemonic({ mnemonic: MNEMONIC })
      await rpc.initializeWDK({ encryptionKey, encryptedSeed: encryptedSeedBuffer, config: CONFIG })
      const disposalsBefore = output.split('\n').filter((line) => line === DISPOSED)

      const { exitCode, disposals } = await terminate(ipc)

      assert.deepStrictEqual(disposalsBefore, [])
      assert.strictEqual(exitCode, 0)
      assert.deepStrictEqual(disposals, [DISPOSED])
    })

    test('should answer an error of a handler as the structured error and keep answering', { timeout: TEST_TIMEOUT }, async () => {
      const { rpc, ipc } = await start()

      const call = rpc.callMethod({ methodName: 'getAddress', network: 'bitcoin', accountIndex: 0 })

      await assert.rejects(call, {
        code: 'WDK_MANAGER_INIT',
        message: '{"code":"WDK_MANAGER_INIT","name":"Error","message":"WDK not initialized. Call initializeWDK first."}'
      })
      assert.deepStrictEqual(await rpc.ping(), {})
      assert.strictEqual((await terminate(ipc)).exitCode, 0)
    })
  })
}
