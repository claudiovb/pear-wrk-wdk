const ERROR_CODES = require('../exceptions/error-codes')
const { decrypt } = require('../utils/crypto')
const logger = require('../utils/logger')
const {
  validateBase64,
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
 *
 * @param {WdkInitializeParams} init
 * @param {RpcContext} context
 * @returns {Promise<{ status: string }>}
 */
async function initializeWdkHandler (init, context) {
  const { WDK, walletManagers, wdk, wdkLoadError, protocolManagers } = context

  // Validate request object (validation of fields happens below)
  if (!init || typeof init !== 'object') {
    throw createErrorWithCode(
      'Init must be an object',
      ERROR_CODES.BAD_REQUEST
    )
  }

  if (!WDK) {
    const errorMsg = wdkLoadError
      ? `WDK failed to load: ${wdkLoadError.message}\nStack: ${wdkLoadError.stack || 'No stack trace'}`
      : 'WDK not loaded - unknown error during initialization'
    throw createErrorWithCode(errorMsg, ERROR_CODES.WDK_MANAGER_INIT)
  }

  if (wdk) {
    logger.info('Disposing existing WDK instance...')
    wdk.dispose()
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
        validateBase64(init.encryptionKey, 'encryptionKey')
        validateBase64(init.encryptedSeed, 'encryptedSeed')
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
      decryptedSeedBuffer = decrypt(init.encryptedSeed, init.encryptionKey)
    } catch (error) {
      throw createErrorWithCode(
        `Failed to decrypt seed: ${error.message}`,
        ERROR_CODES.BAD_REQUEST
      )
    }

    context.wdk = new WDK(decryptedSeedBuffer)
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
      context.wdk.registerWallet(networkName, walletManager, networkConfig.config)
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
      context.wdk.registerProtocol(
        protocolConfig.blockchain,
        protocolName,
        protocolManager,
        protocolConfig.config
      )
    }
  }
  logger.info('WDK initialization complete')
  return { status: 'initialized' }
}

/**
 *
 * @param {WdkResetWalletParams} params
 * @param {RpcContext} context
 * @returns {Promise<{ status: string }>}
 */
async function resetWdkWallets (params, context) {
  const { walletManagers, wdk } = context

  if (!params || typeof params !== 'object') {
    throw createErrorWithCode(
      'Params must be an object',
      ERROR_CODES.BAD_REQUEST
    )
  }

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
  wdk.dispose(targetChains)

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
      wdk.registerWallet(networkName, walletManager, networkConfig.config)
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
 */
async function disposeWdkHandler (request, context) {
  // A non-empty array means a targeted dispose; anything else (omitted, empty
  // array, non-array) falls back to the legacy "dispose everything" behavior.
  const blockchains = request && Array.isArray(request.blockchains) && request.blockchains.length > 0
    ? request.blockchains
    : undefined

  if (context.wdk) {
    if (blockchains) {
      context.wdk.dispose(blockchains)
    } else {
      context.wdk.dispose()
      context.wdk = null
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
