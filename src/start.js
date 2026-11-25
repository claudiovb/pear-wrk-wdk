const { registerRpcHandlers } = require('./rpc-handlers')
const { disposeWdkHandler } = require('./handlers')
const { toRpcError } = require('./exceptions/rpc-exception')

/** @typedef {import('../types/rpc').RpcContext} RpcContext */
/** @typedef {import('../types/hrpc/hrpc').HRPC} HRPC */
/** @typedef {import('../types/bare-rpc')} BareRPC */

/**
 * What bare-stow gives the entry of a bundle packed with a server provider.
 * It also passes `ipc`, the stream under the transport, which is not used.
 * @typedef {Object} StartArguments
 * @property {HRPC | BareRPC} rpc - The transport, as the server provider attached it to the IPC
 *   of the worklet. See createServerProvider in src/stow.js.
 */

/**
 * Stops the worklet: disposes the WDK instance, zeroes the seed and closes the modules.
 * @callback Stop
 * @returns {Promise<void>}
 * @throws {Error} If the WDK instance fails to dispose. It is discarded and the seed is zeroed
 *   all the same. The error is the one the dispose command would answer with: its message is
 *   the JSON of the structured error and it carries the code. bare-stow reports it to the host.
 */

/**
 * Starts the worklet: registers the handlers of every command on the transport.
 * @callback Start
 * @param {StartArguments} args - What bare-stow gives the entry.
 * @returns {Stop} The function bare-stow calls before the worklet exits.
 */

/**
 * Create the entry of a worklet packed with bare-stow. The entry file of the
 * bundle exports what this returns:
 *
 *   module.exports = createStart(context)
 *
 * bare-stow calls it when the worklet starts, and reports the worklet as
 * ready once it has returned, so no command arrives before its handler is
 * registered. It calls the function it gets back before the worklet exits:
 * when the host terminates it, when the host goes away, and when an error is
 * left uncaught.
 * @param {RpcContext} context - Context object containing state and dependencies
 * @returns {Start} The entry.
 */
function createStart (context) {
  return function start ({ rpc }) {
    registerRpcHandlers(rpc, context)

    return async function stop () {
      try {
        await disposeWdkHandler({}, context)
      } catch (error) {
        throw toRpcError(error, { debug: context.debug })
      }
    }
  }
}

module.exports = {
  createStart
}
