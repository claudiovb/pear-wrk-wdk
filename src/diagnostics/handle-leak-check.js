/* global Bare */

// This file intentionally logs handle dumps via console.warn instead of
// logger.warn. logger's level is fixed at require time from LOG_LEVEL/
// NODE_ENV and defaults to ERROR, so logger.warn is a silent no-op unless
// the app happens to also have LOG_LEVEL set - an unrelated precondition
// that would make this opt-in diagnostic look broken. console.warn ensures
// output whenever a caller deliberately registers this check.
const logger = require('../utils/logger')
const { safeStringify } = require('../utils/safe-stringify')

const DEFAULT_TICK_INTERVAL_MS = 1000

let walkHandles = null
try {
  walkHandles = require('bare-walk-handles')
} catch (error) {
  logger.error('bare-walk-handles unavailable, handle-leak check disabled', error)
}

/**
 * handle.type is a raw libuv enum number (e.g. 1) - look up its name in
 * walkHandles.constants (e.g. "TIMER") so logs are readable. Falls back to
 * the raw number if no matching constant is found.
 *
 * @param {object} handle - a handle yielded by bare-walk-handles' walkHandles()
 * @param {number} handle.type - raw libuv enum value
 * @param {bigint} handle.address - native handle memory address
 * @param {boolean} handle.isActive - currently doing something (e.g. a timer counting down)
 * @param {boolean} handle.isClosing - uv_close() called, async teardown not yet finished
 * @param {boolean} handle.hasRef - counts toward keeping the event loop alive; the one to watch for a lingering handle
 * @returns {{ type: (string|number), address: bigint, isActive: boolean, isClosing: boolean, hasRef: boolean }}
 */
function describeHandle (handle) {
  const constants = walkHandles.constants
  const name = Object.keys(constants).find((key) => constants[key] === handle.type)
  return {
    type: name || handle.type,
    address: handle.address,
    isActive: handle.isActive,
    isClosing: handle.isClosing,
    hasRef: handle.hasRef
  }
}

function snapshotHandles () {
  const handles = []
  let refed = 0

  for (const handle of walkHandles()) {
    handles.push(describeHandle(handle))
    if (handle.hasRef) refed++
  }

  return { handles, refed }
}

/**
 * Registers a diagnostic check on Bare's suspend/idle/resume lifecycle that
 * repeatedly walks and logs active handles every `tickIntervalMs` while
 * suspended - from the moment 'suspend' fires until 'idle' finally emits (or
 * 'resume', if idle never comes). This gives a full timeline
 * showing directly whether (and how often) the thread
 * actually gets scheduled during a slow suspend-to-idle gap. The interval is
 * unref'd so it can't itself count as an active handle and block idle
 * detection.
 *
 * @param {{ tickIntervalMs?: number }} [options]
 */
function registerHandleLeakCheck (options = {}) {
  const tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS

  if (!walkHandles || typeof Bare === 'undefined' || !Bare.on) return

  let suspendedAt = null
  let wentIdle = false
  let tickCount = 0
  let tickTimer = null

  function logHandles (label, snap) {
    for (const handle of snap.handles) {
      console.warn(`[handle-leak-check] [${label}] handle active`, safeStringify(handle))
    }
    console.warn(`[handle-leak-check] [${label}] ${snap.handles.length} handle(s) active (${snap.refed} ref'd)`)
  }

  Bare.on('suspend', () => {
    suspendedAt = Date.now()
    wentIdle = false
    tickCount = 0

    logHandles('at suspend (+0ms)', snapshotHandles())

    clearInterval(tickTimer)
    tickTimer = setInterval(() => {
      tickCount++
      const elapsedMs = Date.now() - suspendedAt
      logHandles(`tick #${tickCount} (+${elapsedMs}ms)`, snapshotHandles())
    }, tickIntervalMs)
    tickTimer.unref()
  })

  Bare.on('idle', () => {
    wentIdle = true
    if (suspendedAt !== null) {
      console.warn(`[handle-leak-check] idle after ${Date.now() - suspendedAt}ms and ${tickCount} tick(s)`)
    }
    clearInterval(tickTimer)
  })

  Bare.on('resume', () => {
    if (suspendedAt !== null && !wentIdle) {
      console.warn(`[handle-leak-check] resumed after ${Date.now() - suspendedAt}ms and ${tickCount} tick(s) (never went idle)`)
    }
    suspendedAt = null
    wentIdle = false
    tickCount = 0
    clearInterval(tickTimer)
  })
}

module.exports = { registerHandleLeakCheck }
