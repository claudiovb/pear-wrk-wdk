/**
 * A small set of known secret-bearing field names that cross the HRPC
 * boundary as native `buffer`-typed schema fields (see schema.json), but
 * cross the JSON-RPC boundary as JSON — which has no binary type. This
 * module base64-encodes them on the way out and base64-decodes them back
 * into real Buffers on the way in, so JSON-RPC handlers see and return
 * exactly the same Buffer-based shapes the HRPC transport uses; only the
 * wire representation differs. HRPC never passes through this module —
 * its compact binary encoding carries these fields as real Buffers
 * end-to-end, with no string step at all.
 */
const BUFFER_FIELDS = ['encryptionKey', 'encryptedSeed', 'encryptedEntropy', 'encryptedSeedBuffer', 'encryptedEntropyBuffer']

/**
 * Decode known buffer-typed fields from base64 strings into real Buffers,
 * in place. Used on incoming JSON-RPC params before calling a handler.
 * @param {object} obj - Object to decode (e.g. JSON-RPC request params)
 * @returns {object} The same object, mutated in place
 */
function decodeBufferFields (obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const field of BUFFER_FIELDS) {
    if (typeof obj[field] === 'string') {
      obj[field] = Buffer.from(obj[field], 'base64')
    }
  }
  return obj
}

/**
 * Encode known buffer-typed fields from real Buffers into base64 strings,
 * in place. Used on outgoing JSON-RPC results before JSON-serializing them.
 * @param {object} obj - Object to encode (e.g. a handler's return value)
 * @returns {object} The same object, mutated in place
 */
function encodeBufferFields (obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const field of BUFFER_FIELDS) {
    if (Buffer.isBuffer(obj[field])) {
      obj[field] = obj[field].toString('base64')
    }
  }
  return obj
}

module.exports = { decodeBufferFields, encodeBufferFields }
