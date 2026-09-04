#!/usr/bin/env node

/**
 * Unit tests for the handle-leak diagnostic (src/diagnostics/handle-leak-check.js).
 *
 * Mocks bare-walk-handles via a require() override (same pattern as setup.js)
 * since the module isn't installed in the Node.js test runtime, and fakes the
 * Bare global as a plain EventEmitter to drive suspend/idle/resume.
 *
 * Run with: node --test test/handle-leak-check.test.js
 */

const { test, describe, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')

// Mock bare-walk-handles before the module under test requires it, following
// the same require-override pattern as setup.js
const Module = require('module')
const originalRequire = Module.prototype.require

const stubHandles = [
  { type: 13, address: 0x1234n, isActive: true, isClosing: false, hasRef: true },
  { type: 1, address: 0x5678n, isActive: false, isClosing: true, hasRef: false }
]

function mockWalkHandles () {
  return stubHandles[Symbol.iterator]()
}
mockWalkHandles.constants = { ASYNC: 1, TIMER: 13 }

Module.prototype.require = function (id) {
  if (id === 'bare-walk-handles') return mockWalkHandles
  return originalRequire.apply(this, arguments)
}

const { registerHandleLeakCheck } = require('../src/diagnostics/handle-leak-check')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const TICK_INTERVAL_MS = 100

describe('registerHandleLeakCheck', () => {
  let warnMock

  beforeEach(() => {
    // Fresh emitter per test so listeners from previous registrations don't
    // accumulate across tests
    global.Bare = new EventEmitter()
    warnMock = mock.method(console, 'warn', () => {})
  })

  afterEach(() => {
    // 'resume' unconditionally clears the tick interval - without this, a
    // test that never emits idle/resume leaves its (unref'd) interval
    // running in the background, still firing into later tests' warnMock
    // since console.warn gets re-mocked per test but the old closure keeps
    // calling whatever console.warn currently is.
    if (global.Bare && typeof global.Bare.emit === 'function') {
      global.Bare.emit('resume')
    }
    warnMock.mock.restore()
    delete global.Bare
  })

  const warnLines = () => warnMock.mock.calls.map((c) => c.arguments.join(' '))
  const summaryLines = () => warnLines().filter((l) => l.includes('handle(s) active'))
  const tickLines = () => warnLines().filter((l) => l.includes('tick #'))

  test('logs a handle snapshot immediately on suspend', () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    global.Bare.emit('suspend')

    assert.ok(warnLines().some((l) => l.includes('[at suspend (+0ms)]')))
    assert.ok(summaryLines().some((l) => l.includes('at suspend (+0ms)') && /2 handle\(s\) active \(1 ref'd\)/.test(l)))
  })

  test('resolves libuv type enums to names and stringifies BigInt addresses', () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    global.Bare.emit('suspend')

    const lines = warnLines()
    assert.ok(lines.some((l) => l.includes('"type":"TIMER"')))
    assert.ok(lines.some((l) => l.includes('"type":"ASYNC"')))
    assert.ok(lines.some((l) => l.includes('"address":"4660"'))) // 0x1234n
  })

  test('falls back to the raw numeric type when no matching constant exists', () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    stubHandles.push({ type: 99, address: 0x9999n, isActive: true, isClosing: false, hasRef: false })
    try {
      global.Bare.emit('suspend')
      assert.ok(warnLines().some((l) => l.includes('"type":99')))
    } finally {
      stubHandles.pop()
    }
  })

  test('ticks on an interval while suspended, with an increasing elapsed label', async () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    global.Bare.emit('suspend')
    await sleep(TICK_INTERVAL_MS * 1.5)

    let ticks = tickLines()
    assert.ok(ticks.some((l) => l.includes('tick #1')))
    assert.ok(!ticks.some((l) => l.includes('tick #2')))

    await sleep(TICK_INTERVAL_MS)

    ticks = tickLines()
    assert.ok(ticks.some((l) => l.includes('tick #2')))
  })

  test('stops ticking and logs a summary once idle fires', async () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    global.Bare.emit('suspend')
    await sleep(TICK_INTERVAL_MS * 1.5)
    global.Bare.emit('idle')
    const afterIdle = warnMock.mock.calls.length

    await sleep(TICK_INTERVAL_MS * 2)

    assert.strictEqual(warnMock.mock.calls.length, afterIdle) // no ticks fire after idle
    assert.ok(warnLines().some((l) => /idle after \d+ms and 1 tick\(s\)/.test(l)))
  })

  test('stops ticking and logs a "never went idle" summary if resume fires first', async () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    global.Bare.emit('suspend')
    await sleep(TICK_INTERVAL_MS * 1.5)
    global.Bare.emit('resume')
    const afterResume = warnMock.mock.calls.length

    await sleep(TICK_INTERVAL_MS * 2)

    assert.strictEqual(warnMock.mock.calls.length, afterResume) // no ticks fire after resume
    assert.ok(warnLines().some((l) => /resumed after \d+ms and 1 tick\(s\) \(never went idle\)/.test(l)))
  })

  test('does not log a resume summary once idle already fired', () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })
    global.Bare.emit('suspend')
    global.Bare.emit('idle')
    const afterIdle = warnMock.mock.calls.length

    global.Bare.emit('resume')

    assert.strictEqual(warnMock.mock.calls.length, afterIdle)
  })

  test('resets tick count independently across repeated suspend cycles', async () => {
    registerHandleLeakCheck({ tickIntervalMs: TICK_INTERVAL_MS })

    global.Bare.emit('suspend')
    await sleep(TICK_INTERVAL_MS * 1.5)
    global.Bare.emit('idle')
    global.Bare.emit('resume')

    global.Bare.emit('suspend')
    await sleep(TICK_INTERVAL_MS * 1.5)
    global.Bare.emit('idle')

    // if tickCount had leaked across cycles this would read "2 tick(s)" instead of "1"
    assert.ok(warnLines().some((l) => /idle after \d+ms and 1 tick\(s\)/.test(l)))
  })

  test('does nothing when Bare has no suspend/idle/resume support', () => {
    global.Bare = {} // no .on

    assert.doesNotThrow(() => registerHandleLeakCheck())
    assert.strictEqual(warnMock.mock.calls.length, 0)
  })
})
