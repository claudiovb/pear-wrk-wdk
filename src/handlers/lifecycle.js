const ERROR_CODES = require('../exceptions/error-codes')
const { callExternal, ExternalError } = require('../exceptions/rpc-exception')
const { decrypt, memzero } = require('../utils/crypto')
const { createSecretScope } = require('../utils/secret-scope')
const logger = require('../utils/logger')
const {
  validateBuffer,
  validateJSON,
  validateNonEmptyString,
  validateRequest,
  createErrorWithCode
} = require('../utils/validation')

/** @typedef {import('../../types/rpc').WdkInitializeParams} WdkInitializeParams */
/** @typedef {import('../../types/rpc').WdkResetWalletParams} WdkResetWalletParams */
/** @typedef {import('../../types/rpc').RpcContext} RpcContext */
/** @typedef {import('../../types/rpc').WdkWorkletConfig} WdkWorkletConfig */

/**
 * Zero and release the retained WDK seed buffer, if any.
 * WDK never zeroes the seed it was constructed with, so this is the only
 * place that ever scrubs it.
 * @param {RpcContext} context
 */
function releaseWdkSeedBuffer (context) {
  if (!context.wdkSeedBuffer) return
  memzero(context.wdkSeedBuffer)
  // Clear the reference to the buffer, not just zero out the bytes, so `wdkSeedBuffer` check stays
  // truthy iff a live seed-backed WDK instance exists.
  context.wdkSeedBuffer = null
}

/**
 * Discard the WDK instance together with its seed.
 *
 * The two always go together: WDK keeps the seed buffer it was constructed
 * with, by reference, for its whole life, so an instance does not outlive
 * its seed. Every handler answers that the WDK is not initialized until a
 * new one is made.
 * @param {RpcContext} context
 */
function discardWdk (context) {
  context.wdk = null
  releaseWdkSeedBuffer(context)
}

/**
 *
 * @param {WdkInitializeParams} init
 * @param {RpcContext} context
 * @returns {Promise<{ status: string }>}
 */
async function initializeWdkHandler (init, context) {
  const { WDK, walletManagers, wdk, wdkLoadError, protocolManagers } = context

  if (!init || typeof init !== 'object') {
    throw createErrorWithCode(
      'Init must be an object',
      ERROR_CODES.BAD_REQUEST
    )
  }

  const scope = createSecretScope()

  try {
    scope.track(init.encryptedSeed)
    scope.track(init.encryptionKey)

    if (!WDK) {
      const failure = createErrorWithCode(
        wdkLoadError ? `WDK failed to load: ${wdkLoadError.message}` : 'WDK not loaded - unknown error during initialization',
        ERROR_CODES.WDK_MANAGER_INIT
      )

      // Reported with the causes. Its stack is only sent in a debug build.
      if (wdkLoadError) failure.cause = wdkLoadError

      throw failure
    }

    if (wdk) {
      logger.info('Disposing existing WDK instance...')
      // Close hosted modules too, so they reconstruct with the new seed below.
      if (context.moduleRuntime) await context.moduleRuntime.closeAll()
      await callExternal(ERROR_CODES.WALLET_ERROR, () => wdk.dispose())
      // Wipe only when replacing the seed; config-only re-init reuses it.
      // The instance goes with its seed: if anything below fails, nothing
      // is left to register a wallet on.
      if (init.encryptedSeed && init.encryptionKey) {
        discardWdk(context)
      }
    }

    /** @type {WdkWorkletConfig} */
    let workletConfig
    validateRequest(
      init,
      () => {
        validateNonEmptyString(init.config, 'config')
        workletConfig = validateJSON(init.config, 'config')

        const isValidParams = (init.encryptedSeed && init.encryptionKey) || (!init.encryptedSeed && !init.encryptionKey)

        if (!isValidParams) {
          throw createErrorWithCode(
            'encryptionKey and encryptedSeed must be provided or omitted',
            ERROR_CODES.BAD_REQUEST
          )
        }

        if (init.encryptedSeed && init.encryptionKey) {
          validateBuffer(init.encryptionKey, 'encryptionKey')
          validateBuffer(init.encryptedSeed, 'encryptedSeed')
        }
      },
      'Init'
    )

    if (
      !workletConfig ||
      !workletConfig.networks ||
      typeof workletConfig.networks !== 'object' ||
      Object.keys(workletConfig.networks).length === 0
    ) {
      throw createErrorWithCode(
        'At least one network configuration must be provided',
        ERROR_CODES.BAD_REQUEST
      )
    }

    if (init.encryptionKey && init.encryptedSeed) {
      logger.info('Initializing WDK with encrypted seed')
      let decryptedSeedBuffer
      try {
        decryptedSeedBuffer = scope.track(decrypt(init.encryptedSeed, init.encryptionKey))
      } catch (error) {
        throw createErrorWithCode(
          `Failed to decrypt seed: ${error.message}`,
          ERROR_CODES.DECRYPTION_FAILED
        )
      }

      // Construct seed-bound modules before WDK takes the buffer; factories consume
      // the seed synchronously — the same buffer the wallet uses, never copied or retained.
      if (workletConfig.modules && Object.keys(workletConfig.modules).length > 0) {
        if (context.moduleRuntime) {
          context.moduleRuntime.constructFromConfig(workletConfig.modules, decryptedSeedBuffer)
        } else {
          logger.warn('Modules configured but none bundled (no module runtime); skipping')
        }
      }

      // Created and stored in the same step. With an await between the two,
      // a dispose sent right behind this call finds no instance, answers,
      // and the instance is stored after it. Might be not needed after tetherto/pear-wrk-wdk#88 when we add atomic lifecycle
      try {
        context.wdk = new WDK(decryptedSeedBuffer)
      } catch (error) {
        throw new ExternalError(ERROR_CODES.WDK_MANAGER_INIT, error)
      }
      // WDK retains this buffer and never zeroes it itself (see
      // releaseWdkSeedBuffer) — release it from the scope so close()
      // doesn't zero out live wallet key material. From here on it
      // survives even if later registration steps below throw, matching
      // a partially-initialized wdk that's still live and needs it.
      context.wdkSeedBuffer = scope.release(decryptedSeedBuffer)
    }

    if (!context.wdk) {
      throw createErrorWithCode(
        'WDK must be initialized with a seed before module registration.',
        ERROR_CODES.WDK_MANAGER_INIT
      )
    }

    for (const [networkName, networkConfig] of Object.entries(workletConfig.networks)) {
      const blockchain = networkConfig.blockchain

      if (networkName !== blockchain) {
        throw createErrorWithCode(
          `Network key "${networkName}" must match blockchain field "${blockchain}"`,
          ERROR_CODES.BAD_REQUEST
        )
      }

      if (networkConfig.config && typeof networkConfig.config === 'object') {
        const walletManager = walletManagers[networkName]

        if (!walletManager) {
          throw createErrorWithCode(
            `No wallet manager found for blockchain: ${networkName}`,
            ERROR_CODES.WDK_MANAGER_INIT
          )
        }

        logger.info(`Registering ${networkName} wallet`)
        await callExternal(ERROR_CODES.WALLET_ERROR, () => context.wdk.registerWallet(networkName, walletManager, networkConfig.config))
      }
    }

    if (
      workletConfig.protocols &&
      Object.keys(workletConfig.protocols).length > 0
    ) {
      for (const protocolConfig of Object.values(workletConfig.protocols)) {
        const protocolName = protocolConfig.protocolName
        const protocolManager = protocolManagers[protocolName]

        if (!protocolManager) {
          throw createErrorWithCode(
            `No protocol manager found for protocol: ${protocolName}`,
            ERROR_CODES.WDK_MANAGER_INIT
          )
        }

        if (!walletManagers[protocolConfig.blockchain]) {
          throw createErrorWithCode(
            `No wallet manager found for network: ${protocolConfig.blockchain}`,
            ERROR_CODES.BAD_REQUEST
          )
        }
        logger.info(`Registering ${protocolName} protocol`)
        await callExternal(ERROR_CODES.PROTOCOL_ERROR, () => context.wdk.registerProtocol(
          protocolConfig.blockchain,
          protocolName,
          protocolManager,
          protocolConfig.config
        ))
      }
    }
    logger.info('WDK initialization complete')
    return { status: 'initialized' }
  } finally {
    scope.close()
  }
}

/**
 *
 * @param {WdkResetWalletParams} params
 * @param {RpcContext} context
 * @returns {Promise<{ status: string }>}
 */
async function resetWdkWallets (params, context) {
  const { walletManagers, wdk } = context

  /** @type {Omit<WdkWorkletConfig, 'protocols'>} */
  let workletConfig
  validateRequest(
    params,
    () => {
      validateNonEmptyString(params.config, 'config')
      workletConfig = validateJSON(params.config, 'config')
    },
    'Worklet config'
  )

  if (
    !workletConfig ||
    !workletConfig.networks ||
    typeof workletConfig.networks !== 'object' ||
    Object.keys(workletConfig.networks).length === 0
  ) {
    throw createErrorWithCode(
      'At least one network configuration must be provided',
      ERROR_CODES.BAD_REQUEST
    )
  }

  if (!wdk) {
    throw createErrorWithCode(
      'WDK must be initialized with a seed before module reset.',
      ERROR_CODES.WDK_MANAGER_INIT
    )
  }

  const targetChains = Object.values(workletConfig.networks)
    .filter(networkConfig => networkConfig.config && typeof networkConfig.config === 'object')
    .map(networkConfig => networkConfig.blockchain)
  // Only disposes these chains; modules stay up (a full dispose closes them).
  await callExternal(ERROR_CODES.WALLET_ERROR, () => wdk.dispose(targetChains))

  for (const networkConfig of Object.values(workletConfig.networks)) {
    const networkName = networkConfig.blockchain

    if (networkConfig.config && typeof networkConfig.config === 'object') {
      const walletManager = walletManagers[networkName]

      if (!walletManager) {
        throw createErrorWithCode(
          `No wallet manager found for network: ${networkName}`,
          ERROR_CODES.WDK_MANAGER_INIT
        )
      }

      logger.info(`Registering ${networkName} wallet`)
      await callExternal(ERROR_CODES.WALLET_ERROR, () => wdk.registerWallet(networkName, walletManager, networkConfig.config))
    }
  }

  logger.info('WDK wallet reset completed for', targetChains)
  return { status: 'reset' }
}

/**
 * Dispose the WDK instance, fully or for specific blockchains.
 *
 * @param {{ blockchains?: string[] }} [request] - Optional list of blockchains to
 *   dispose. Omit to dispose the entire WDK instance.
 * @param {RpcContext} context
 * @throws {Error} With the code BAD_REQUEST, if `blockchains` is given and is not a list.
 */
async function disposeWdkHandler (request, context) {
  // A value that is not a list is refused: read as "no list", it would dispose everything.
  if (request && request.blockchains != null && !Array.isArray(request.blockchains)) {
    throw createErrorWithCode('blockchains must be a list of blockchain names', ERROR_CODES.BAD_REQUEST)
  }

  // A non-empty array means a targeted dispose; omitted or an empty array
  // falls back to the legacy "dispose everything" behavior.
  const blockchains = request && Array.isArray(request.blockchains) && request.blockchains.length > 0
    ? request.blockchains
    : undefined

  if (blockchains) {
    if (context.wdk) await callExternal(ERROR_CODES.WALLET_ERROR, () => context.wdk.dispose(blockchains))
  } else {
    try {
      if (context.wdk) await callExternal(ERROR_CODES.WALLET_ERROR, () => context.wdk.dispose())
    } finally {
      // Even if dispose() throws, don't leave a half-torn-down wdk in
      // place or the seed buffer unwiped.
      discardWdk(context)
      // Full dispose only: tear down hosted modules so their resources don't leak on
      // lock. A targeted per-blockchain dispose leaves the wallet — and its modules — running.
      if (context.moduleRuntime) await context.moduleRuntime.closeAll()
    }
  }

  logger.info('WDK disposed', blockchains || 'all')
  return { status: 'disposed' }
}
module.exports = {
  initializeWdkHandler,
  disposeWdkHandler,
  resetWdkWallets
}
