#!/usr/bin/env node

/**
 * Integration test: the generic module subsystem over the REAL generated HRPC.
 *
 * Two HRPC instances are connected over an in-memory duplex pair; the worklet
 * side registers the full handler set (registerRpcHandlers) with a context that
 * has a fake module, then constructs it (as WDK init would — construction is
 * config-driven, not a wire op). The host calls callModule/closeModule and
 * receives moduleEvent notifications — all through the actual generated client.
 * This squashes the Stage-1 "toy transport" caveat.
 *
 * Run with: node --test test/modules-hrpc.test.js
 */

require('./setup.js')

const { test } = require('node:test')
const assert = require('node:assert')
const { Duplex } = require('streamx')
const b4a = require('b4a')
const { EventEmitter } = require('events')

const HRPC = require('../generated/hrpc')
const { registerRpcHandlers } = require('../src/rpc-handlers')

class FakeModule extends EventEmitter {
  constructor () { super(); this.items = [] }
  addItem (input) { const item = { id: String(this.items.length + 1), ...input }; this.items.push(item); this.emit('update'); return item }
  listItems () { return this.items.slice() }
  clear () { this.items = [] } // void return — exercises undefined round-trip
  async close () { this.closed = true }
}

function createPipePair () {
  const a = new Duplex({ write (data, cb) { queueMicrotask(() => b.push(b4a.from(data))); cb(null) } })
  const b = new Duplex({ write (data, cb) { queueMicrotask(() => a.push(b4a.from(data))); cb(null) } })
  return [a, b]
}

function withTimeout (p, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

test('module subsystem over real HRPC: call / event', async () => {
  const [hostStream, workletStream] = createPipePair()
  const workletRpc = new HRPC(workletStream)
  const hostRpc = new HRPC(hostStream)

  const context = {
    wdk: {},
    WDK: class {},
    walletManagers: {},
    protocolManagers: {},
    wdkLoadError: null,
    capabilities: {},
    moduleManagers: {
      fake: {
        events: ['update'],
        createModule: () => new FakeModule()
      }
    }
  }
  registerRpcHandlers(workletRpc, context)

  // Construct the module as WDK init would (config-driven; not a wire op).
  await context.moduleRuntime.construct('fake', {}, Buffer.alloc(64, 0xab))

  // Collect module events from the start so none are missed.
  const moduleEvents = []
  let resolveEvent = null
  hostRpc.onModuleEvent((evt) => {
    moduleEvents.push(evt)
    if (resolveEvent) { resolveEvent(evt); resolveEvent = null }
  })

  // call
  const addRes = await hostRpc.callModule({ module: 'fake', method: 'addItem', args: JSON.stringify([{ name: 'x' }]) })
  assert.strictEqual(JSON.parse(addRes.result).name, 'x', 'callModule over real HRPC')

  const listRes = await hostRpc.callModule({ module: 'fake', method: 'listItems', args: JSON.stringify([]) })
  assert.strictEqual(JSON.parse(listRes.result).length, 1, 'listItems over real HRPC')

  // void-returning method round-trips as an absent result over real HRPC
  const clearRes = await hostRpc.callModule({ module: 'fake', method: 'clear', args: JSON.stringify([]) })
  assert.ok(
    clearRes.result === undefined || clearRes.result === null || clearRes.result === '',
    'void method returns no result over real HRPC'
  )
  const afterClear = JSON.parse((await hostRpc.callModule({ module: 'fake', method: 'listItems', args: JSON.stringify([]) })).result)
  assert.strictEqual(afterClear.length, 0, 'clear() (void) round-tripped and emptied items')

  // event worklet -> host (the addItem above emitted 'update')
  const evt = moduleEvents.length
    ? moduleEvents[moduleEvents.length - 1]
    : await withTimeout(new Promise((resolve) => { resolveEvent = resolve }), 5000)
  assert.strictEqual(evt.module, 'fake')
  assert.strictEqual(evt.event, 'update', 'moduleEvent delivered over real HRPC')
})
