#!/usr/bin/env node

/**
 * Unit tests for the generic module runtime (src/handlers/modules.js).
 *
 * Uses a FAKE module (no address book, no holepunch) to prove the runtime is
 * truly module-agnostic: config-based construction, callModule dispatch,
 * Buffer->hex normalization, event forwarding, and lifecycle.
 *
 * Run with: node --test test/modules.test.js
 */

require('./setup.js')

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')

const { createModuleRuntime } = require('../src/handlers/modules')

// A minimal, dependency-free fake module that satisfies the contract. It owns
// no storage; the runtime knows nothing about corestore.
class FakeModule extends EventEmitter {
  constructor (ctx) {
    super()
    this.ctx = ctx
    this.items = []
    this.closed = false
    this.suspended = false
  }

  addItem (input) {
    const item = { id: String(this.items.length + 1), ...input }
    this.items.push(item)
    this.emit('update') // contract event
    return item
  }

  listItems () { return this.items.slice() }

  // Returns a Uint8Array to exercise Buffer->hex normalization.
  getKey () { return new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }

  async close () { this.closed = true }
  async suspend () { this.suspended = true }
  async resume () { this.suspended = false }
}

function makeManagers () {
  return {
    fake: {
      events: ['update'],
      createModule: (ctx) => new FakeModule(ctx)
    }
  }
}

function makeRuntime (overrides = {}) {
  const events = []
  const rpc = { moduleEvent: (payload) => events.push(payload) }
  const context = {
    moduleManagers: makeManagers(),
    capabilities: {},
    ...overrides
  }
  return { rt: createModuleRuntime(rpc, context), events, context }
}

const SEED = Buffer.alloc(64, 0xab)

describe('module runtime (generic)', () => {
  test('construct builds the module and passes the context object', async () => {
    const { rt, context } = makeRuntime()
    await rt.construct('fake', { foo: 1 }, SEED)
    assert.ok(context.moduleInstances.has('fake'), 'instance tracked on context')
    const entry = context.moduleInstances.get('fake')
    assert.ok(entry.instance instanceof FakeModule)
    assert.deepStrictEqual(entry.instance.ctx.config, { foo: 1 }, 'config forwarded to factory')
    assert.strictEqual(entry.instance.ctx.seed, SEED, 'seed forwarded to factory (no store)')
    assert.strictEqual(entry.instance.ctx.store, undefined, 'runtime does not build/pass a store')
  })

  test('callModule dispatches CRUD and normalizes Buffer returns to hex', async () => {
    const { rt } = makeRuntime()
    await rt.construct('fake', {}, SEED)

    const added = JSON.parse((await rt.callModule({ module: 'fake', method: 'addItem', args: JSON.stringify([{ name: 'x' }]) })).result)
    assert.strictEqual(added.name, 'x')

    const list = JSON.parse((await rt.callModule({ module: 'fake', method: 'listItems', args: '[]' })).result)
    assert.strictEqual(list.length, 1)

    const key = JSON.parse((await rt.callModule({ module: 'fake', method: 'getKey', args: '[]' })).result)
    assert.strictEqual(key, 'deadbeef', 'Uint8Array return normalized to hex')
  })

  test('events are forwarded host-ward as moduleEvent', async () => {
    const { rt, events } = makeRuntime()
    await rt.construct('fake', {}, SEED)
    await rt.callModule({ module: 'fake', method: 'addItem', args: JSON.stringify([{ name: 'y' }]) })
    const update = events.find((e) => e.event === 'update')
    assert.ok(update, 'an update moduleEvent was emitted')
    assert.strictEqual(update.module, 'fake')
  })

  test('unknown module is rejected', () => {
    const { rt } = makeRuntime()
    assert.throws(() => rt.construct('nope', {}, SEED), /Unknown module/)
  })

  test('seedless modules construct without a seed', async () => {
    // The FakeModule ignores `seed`, so it must construct even when none exists.
    const { rt, context } = makeRuntime()
    await rt.construct('fake', {}, null)
    assert.ok(context.moduleInstances.get('fake').instance instanceof FakeModule)
  })

  test('retains the construction error and surfaces it via callModule', async () => {
    const events = []
    const rpc = { moduleEvent: (p) => events.push(p) }
    const context = {
      moduleManagers: {
        boom: { createModule: async () => { throw new Error('construction failed') } }
      },
      capabilities: {}
    }
    const rt = createModuleRuntime(rpc, context)
    await assert.rejects(() => rt.construct('boom', {}, SEED), /construction failed/)

    // Retained (not forgotten) with the error, so callModule can tell "failed to
    // initialize" apart from "never configured".
    assert.strictEqual(context.moduleInstances.has('boom'), true, 'failed entry retained')
    assert.ok(context.moduleInstances.get('boom').error, 'error recorded on the entry')

    const errored = events.find((e) => e.event === 'error')
    assert.ok(errored, 'an error moduleEvent was emitted')
    assert.strictEqual(errored.module, 'boom')
    const payload = JSON.parse(errored.payload)
    assert.strictEqual(payload.name, 'Error')
    assert.strictEqual(payload.message, 'construction failed')
    assert.ok(payload.stack, 'error payload carries a stack for app devs')

    // A failed module reports its construction error distinctly...
    await assert.rejects(
      () => rt.callModule({ module: 'boom', method: 'x', args: '[]' }),
      /failed to initialize: construction failed/
    )
    // ...whereas a never-configured module still reports "not initialized".
    await assert.rejects(
      () => rt.callModule({ module: 'ghost', method: 'x', args: '[]' }),
      /Module not initialized/
    )
  })

  test('callModule awaits an async (pending) construction', async () => {
    const rpc = { moduleEvent: () => {} }
    let resolveCtor
    const context = {
      moduleManagers: {
        slow: {
          createModule: () => new Promise((resolve) => { resolveCtor = () => resolve({ ping: () => 'pong' }) })
        }
      },
      capabilities: {}
    }
    const rt = createModuleRuntime(rpc, context)
    rt.construct('slow', {}, SEED) // pending — not awaited
    const callPromise = rt.callModule({ module: 'slow', method: 'ping', args: '[]' })
    resolveCtor()
    const res = JSON.parse((await callPromise).result)
    assert.strictEqual(res, 'pong', 'callModule waited for construction to finish')
  })

  test('suspendAll / resumeAll drive each module\'s suspend()/resume()', async () => {
    const { rt, context } = makeRuntime()
    await rt.construct('fake', {}, SEED)
    const instance = context.moduleInstances.get('fake').instance
    await rt.suspendAll()
    assert.strictEqual(instance.suspended, true, 'suspend() called')
    await rt.resumeAll()
    assert.strictEqual(instance.suspended, false, 'resume() called')
  })

  test('constructFromConfig builds every configured module; closeAll tears them down', async () => {
    const { rt, context } = makeRuntime()
    rt.constructFromConfig({ fake: { foo: 2 } }, SEED)
    await context.moduleInstances.get('fake').ready
    const instance = context.moduleInstances.get('fake').instance
    assert.ok(instance instanceof FakeModule)
    assert.deepStrictEqual(instance.ctx.config, { foo: 2 })

    await rt.closeAll()
    assert.strictEqual(context.moduleInstances.size, 0, 'all instances cleared')
    assert.strictEqual(instance.closed, true, 'instance.close() called')
  })
})
