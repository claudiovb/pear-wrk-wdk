const secrets = require('./secrets')
const lifecycle = require('./lifecycle')
const execution = require('./execution')
const config = require('./config')
const modules = require('./modules')

module.exports = {
  ...secrets,
  ...lifecycle,
  ...execution,
  ...config,
  ...modules
}
