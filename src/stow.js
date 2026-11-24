/**
 * The server providers of bare-stow for the two transports. A provider tells
 * bare-stow how to attach an RPC library to the IPC of the worklet: it
 * generates a small module, packed next to the entry of the bundle, whose
 * attach(ipc) returns what the entry is then started with.
 *
 * This file runs where the bundle is built (Node), not in the worklet, so it
 * must not require anything that needs Bare.
 */

/** The name the generated module requires this package by. */
const PACKAGE_NAME = '@tetherto/pear-wrk-wdk'

/** @typedef {import('../types/bare-rpc').BareRPCOptions} BareRPCOptions */

/**
 * What bare-stow asks a provider to generate.
 * @typedef {Object} GenerateContext
 * @property {'client' | 'server'} role - The side to generate for: the host or the bundle.
 * @property {{ module?: 'esm' | 'cjs' }} options - The options of the language.
 */

/**
 * A module generated for bare-stow.
 * @typedef {Object} Generated
 * @property {string} source - The source of the module.
 */

/**
 * An RPC library, as bare-stow takes one in its `server` option.
 * @typedef {Object} ServerProvider
 * @property {string} name - The name of the provider.
 * @property {{ javascript: { generate: (context: GenerateContext) => Generated } }} languages -
 *   The languages it generates for. A worklet is always JavaScript.
 */

/**
 * The class of each transport: the name it is given in the generated module
 * and the export of this package it is required from.
 */
const TRANSPORTS = {
  'bare-rpc': { className: 'BareRPC', specifier: `${PACKAGE_NAME}/bare-rpc` },
  hrpc: { className: 'HRPC', specifier: `${PACKAGE_NAME}/hrpc` }
}

/**
 * Create the bare-stow server provider of a transport. It is given to
 * bare-stow when the bundle is packed:
 *
 *   stow(entry, target, out, { server: createServerProvider('bare-rpc') })
 *
 * The worklet then serves that transport, and the entry made by createStart
 * (./worklet) receives an instance of its class. Only the code of that
 * transport is packed.
 * @param {'bare-rpc' | 'hrpc'} transport - The transport the worklet serves.
 * @param {BareRPCOptions} [options] - The limits of the session. For 'bare-rpc' only: HRPC has none.
 * @returns {ServerProvider} The provider.
 */
function createServerProvider (transport, options) {
  const { className, specifier } = TRANSPORTS[transport]

  const args = options ? `ipc, ${JSON.stringify(options)}` : 'ipc'

  /**
   * @param {GenerateContext} context - What bare-stow asks for.
   * @returns {Generated} The module that attaches the transport to the IPC of the worklet.
   * @throws {Error} If asked for the client role: the host side is not JavaScript generated here.
   */
  function generate ({ role, options: languageOptions }) {
    if (role !== 'server') {
      throw new Error(`${specifier} is a server provider: it generates nothing for the ${role} role`)
    }

    const source = languageOptions.module === 'esm'
      ? `\
import ${className} from '${specifier}'

export function attach (ipc) {
  return new ${className}(${args})
}
`
      : `\
const ${className} = require('${specifier}')

exports.attach = function attach (ipc) {
  return new ${className}(${args})
}
`

    return { source }
  }

  return {
    name: specifier,
    languages: {
      javascript: { generate }
    }
  }
}

module.exports = {
  createServerProvider
}
