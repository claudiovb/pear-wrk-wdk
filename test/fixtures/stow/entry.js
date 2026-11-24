/**
 * The entry of the worklet that test/stow.smoke.js packs with bare-stow and
 * runs under Bare. It has the shape of the entry the bundler generates: the
 * globals of bare-wdk-runtime, the context, and the start function made by
 * createStart.
 *
 * The WDK is a stand-in, so that the test needs no wallet package and no
 * network. Everything else is the real code of the worklet.
 */

// Bare has no TextEncoder of its own, and deriving a seed from a mnemonic needs one.
require('bare-wdk-runtime/global')

const { createStart } = require('@tetherto/pear-wrk-wdk/worklet', { with: { imports: 'bare-wdk-runtime/imports' } })

/**
 * What the stand-in writes to the output of the worklet when it is disposed.
 * The test reads it to tell that the WDK was disposed after the last answer.
 */
const DISPOSED = 'fixture: WDK disposed'

class WDK {
  registerWallet () {}

  async getAccount (network, index) {
    return {
      getAddress: async () => `${network}:${index}`
    }
  }

  dispose () {
    console.log(DISPOSED)
  }
}

const context = {
  wdk: null,
  WDK,
  walletManagers: { bitcoin: { name: 'bitcoin manager' } },
  protocolManagers: {},
  wdkLoadError: null
}

module.exports = createStart(context)
