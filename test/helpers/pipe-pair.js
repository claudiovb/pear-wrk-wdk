const { Duplex } = require('streamx')
const b4a = require('b4a')

/**
 * Create two connected in-memory streams: what is written to one is read from
 * the other. They stand in for the two ends of the IPC between a host and a
 * worklet.
 * @returns {[Duplex, Duplex]} The two ends of the pipe.
 */
function createPipePair () {
  const a = new Duplex({ write (data, cb) { queueMicrotask(() => b.push(b4a.from(data))); cb(null) } })
  const b = new Duplex({ write (data, cb) { queueMicrotask(() => a.push(b4a.from(data))); cb(null) } })
  return [a, b]
}

module.exports = { createPipePair }
