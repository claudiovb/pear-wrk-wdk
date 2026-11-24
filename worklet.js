const { registerRpcHandlers } = require('./src/rpc-handlers')
const { createStart } = require('./src/start')
const crypto = require('./src/utils/crypto')
const logger = require('./src/utils/logger')
const validation = require('./src/utils/validation')
const errorCodes = require('./src/exceptions/error-codes')
const rpcException = require('./src/exceptions/rpc-exception')

module.exports = {
  registerRpcHandlers,
  createStart,
  utils: {
    crypto,
    logger,
    validation
  },
  exceptions: {
    errorCodes,
    rpcException
  }
}
