const RPC = require('bare-rpc')
const AbortController = require('bare-abort-controller')
const c = require('compact-encoding')
const ERROR_CODES = require('../exceptions/error-codes')
const { toRpcError } = require('../exceptions/rpc-exception')
const logger = require('../utils/logger')
const memzero = require('../utils/memzero')

/**
 * The hand-written part of the bare-rpc transport. The class in
 * generated/bare-rpc extends BareRPCRuntime with one pair of methods per
 * command of src/hrpc/hrpc.json; everything those methods share is here.
 *
 * bare-rpc does the session, the frame limits and the dispatch by command
 * id. What it has no notion of is the payload: here it is the struct of
 * schema.json written as JSON, with the `buffer` fields as base64 strings.
 *
 * It loads outside Bare too (a host uses the same class as a client), so it
 * must not require anything that needs bare-crypto.
 */

/**
 * Converts one message to and from the payload of a frame.
 * @typedef {Object} Codec
 * @property {(message: unknown) => Buffer | null} encode - Writes a message as a payload.
 * @property {(payload: Uint8Array | null) => unknown} decode - Reads a message from a payload.
 */

/**
 * The codecs of one command.
 * @typedef {Object} CommandCodecs
 * @property {Codec} request - The codec of its request.
 * @property {Codec} [response] - The codec of its response. Left out for an event, which has none.
 */

/** The largest frame accepted from the peer, in bytes, unless the options say otherwise. */
const DEFAULT_MAX_FRAME_SIZE = 16 * 1024 * 1024

/** The most bytes a stream of the session may buffer, unless the options say otherwise. */
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024

/**
 * What a buffer field looks like on the wire once its line breaks and its
 * padding are removed: base64, in the standard or the URL-safe alphabet.
 */
const BASE64 = /^[A-Za-z0-9+/_-]*$/

/**
 * The options every command is registered with on the router. The router
 * then hands over the payload as it arrived and sends back what the handler
 * returns: decoding and encoding happen in _respond, in the same try as the
 * handler, so that nothing they throw reaches bare-rpc as it is.
 */
const NO_ENCODING = { requestEncoding: null, responseEncoding: null }

/**
 * Create the codec of one message: JSON, with the given fields as base64
 * strings on the wire and as Buffers on both sides of it.
 * @param {string[]} [bufferFields] - The fields of the message that are `buffer` in schema.json.
 * @param {Object} [options]
 * @param {boolean} [options.zeroAfterEncode=false] - Whether to zero the Buffers of the message
 *   once it is encoded. For the responses of the worklet: nothing else reads them afterwards.
 * @returns {Codec} The codec.
 */
function json (bufferFields = [], { zeroAfterEncode = false } = {}) {
  return {
    /**
     * @param {unknown} message - The message. Nothing is written for null and undefined.
     * @returns {Buffer | null} The payload.
     * @throws {Error} With the code INTERNAL_ERROR, if the message cannot be written as JSON.
     */
    encode (message) {
      if (message === undefined || message === null) return null

      try {
        return c.encode(c.raw.json, buffersToBase64(message, bufferFields))
      } catch (cause) {
        const error = new Error('Message cannot be written as JSON', { cause })
        error.code = ERROR_CODES.INTERNAL_ERROR
        throw error
      } finally {
        if (zeroAfterEncode) zeroBuffers(message, bufferFields)
      }
    },

    /**
     * @param {Uint8Array | null} payload - The payload. An empty one is a message that was left out.
     * @returns {unknown} The message, or null if the payload is empty.
     * @throws {Error} With the code BAD_REQUEST, if the payload is not valid JSON, or if one of
     *   its buffer fields is not base64.
     */
    decode (payload) {
      if (payload === null || payload.byteLength === 0) return null

      let message
      try {
        message = c.decode(c.raw.json, payload)
      } catch {
        // The parser quotes the text it failed on, which can be secret material.
        const error = new Error('Payload is not valid JSON')
        error.code = ERROR_CODES.BAD_REQUEST
        throw error
      }

      return base64ToBuffers(message, bufferFields)
    }
  }
}

/**
 * Copy a message with its buffer fields replaced by base64 strings.
 * @param {unknown} message - The message.
 * @param {string[]} bufferFields - The buffer fields of the message.
 * @returns {unknown} The copy, or the message itself if it has no buffer fields.
 */
function buffersToBase64 (message, bufferFields) {
  if (bufferFields.length === 0 || typeof message !== 'object') return message

  const copy = { ...message }

  for (const field of bufferFields) {
    const value = copy[field]

    if (ArrayBuffer.isView(value)) {
      copy[field] = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64')
    }
  }

  return copy
}

/**
 * Replace the base64 strings in the buffer fields of a message by Buffers, in place.
 *
 * The text is checked here and not left to Buffer.from, which does not behave
 * the same everywhere: on Bare it throws for a line break or a character that
 * is not base64, and on Node it skips them and returns other bytes. Line
 * breaks are accepted, because some encoders add them (MIME).
 * @param {unknown} message - The message.
 * @param {string[]} bufferFields - The buffer fields of the message.
 * @returns {unknown} The message.
 * @throws {Error} With the code BAD_REQUEST, if a buffer field is a string that is not base64.
 *   The Buffers made from the fields before it are zeroed.
 */
function base64ToBuffers (message, bufferFields) {
  if (message === null || typeof message !== 'object') return message

  for (const field of bufferFields) {
    if (typeof message[field] !== 'string') continue

    const text = message[field].replace(/\s+/g, '').replace(/={1,2}$/, '')

    if (!BASE64.test(text) || text.length % 4 === 1) {
      zeroBuffers(message, bufferFields)

      // The message names the field, never its text.
      const error = new Error(`${field} must be a base64 string`)
      error.code = ERROR_CODES.BAD_REQUEST
      throw error
    }

    message[field] = Buffer.from(text, 'base64')
  }

  return message
}

/**
 * Zero the Buffers in the buffer fields of a message.
 * @param {unknown} message - The message.
 * @param {string[]} bufferFields - The buffer fields of the message.
 */
function zeroBuffers (message, bufferFields) {
  if (typeof message !== 'object') return

  for (const field of bufferFields) {
    if (ArrayBuffer.isView(message[field])) memzero(message[field])
  }
}

class BareRPCRuntime {
  /**
   * @param {object} stream - The duplex stream to the peer (the IPC of the worklet).
   * @param {Object} [options]
   * @param {number} [options.maxFrameSize] - The largest frame accepted from the peer, in bytes.
   *   The session fails when a larger one arrives. Defaults to DEFAULT_MAX_FRAME_SIZE.
   * @param {number} [options.maxBufferedBytes] - The most bytes a stream of the session may buffer.
   *   Defaults to DEFAULT_MAX_BUFFERED_BYTES.
   */
  constructor (stream, { maxFrameSize = DEFAULT_MAX_FRAME_SIZE, maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES } = {}) {
    /**
     * Dispatches each incoming command to the handler registered for its id.
     * A request for an id with no handler is answered with UNKNOWN_COMMAND.
     * @protected
     * @type {RPC.CommandRouter}
     */
    this._router = new RPC.CommandRouter()

    /**
     * The bare-rpc session over the stream.
     * @protected
     * @type {RPC}
     */
    this._rpc = new RPC(stream, this._router, { AbortController, maxFrameSize, maxBufferedBytes })
  }

  /**
   * Send a request and wait for its response.
   * @protected
   * @param {number} command - The id of the command.
   * @param {CommandCodecs} codecs - The codecs of the command.
   * @param {unknown} args - The request.
   * @returns {Promise<unknown>} The response.
   * @throws {Error} The error the peer answered with, carrying its message and its code.
   */
  async _call (command, codecs, args) {
    const request = this._rpc.request(command)

    request.send(codecs.request.encode(args))

    return codecs.response.decode(await request.reply())
  }

  /**
   * Send an event: a command that has no response.
   * @protected
   * @param {number} command - The id of the command.
   * @param {CommandCodecs} codecs - The codecs of the command.
   * @param {unknown} args - The request.
   */
  _send (command, codecs, args) {
    this._rpc.event(command).send(codecs.request.encode(args))
  }

  /**
   * Register the handler of a command.
   *
   * Whatever goes wrong while decoding the request, running the handler or
   * encoding the response is answered as an error made by toRpcError, which
   * is always a plain Error. bare-rpc would rethrow a TypeError, a
   * SyntaxError or a RangeError as an uncaught exception instead of
   * answering, and that ends the worklet. An event has no response to carry
   * an error, and bare-rpc ends the session when the handler of one throws,
   * so its error is logged.
   * @protected
   * @param {number} command - The id of the command.
   * @param {CommandCodecs} codecs - The codecs of the command.
   * @param {(request: unknown) => unknown} responseFn - The handler.
   */
  _respond (command, codecs, responseFn) {
    this._router.respond(command, NO_ENCODING, async (req) => {
      try {
        const response = await responseFn(codecs.request.decode(req.data))

        return codecs.response ? codecs.response.encode(response) : null
      } catch (error) {
        const rpcError = toRpcError(error)

        // An event carries no id.
        if (req.id !== undefined) throw rpcError

        logger.error(`The handler of command ${command} failed on an event:`, rpcError.message)

        return null
      }
    })
  }
}

BareRPCRuntime.DEFAULT_MAX_FRAME_SIZE = DEFAULT_MAX_FRAME_SIZE
BareRPCRuntime.DEFAULT_MAX_BUFFERED_BYTES = DEFAULT_MAX_BUFFERED_BYTES

module.exports = {
  BareRPCRuntime,
  json
}
