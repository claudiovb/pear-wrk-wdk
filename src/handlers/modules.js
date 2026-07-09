const ERROR_CODES = require('../exceptions/error-codes')
const logger = require('../utils/logger')
const { safeStringify } = require('../utils/safe-stringify')
const {
  validateNonEmptyString,
  validateJSON,
  validateRequest,
  createErrorWithCode
} = require('../utils/validation')

/** @typedef {import('../../types/rpc').RpcContext} RpcContext */
/** @typedef {import('../../types/rpc').ModuleEventRequest} ModuleEventRequest */
/**
 * @typedef {Object} ModuleEventEmitter
 * @property {(request: ModuleEventRequest) => void} moduleEvent - Send a module event to the host.
 */

/**
 * Generic, module-agnostic runtime for bundled WDK modules. Modules are built from
 * config at WDK init via context.moduleManagers, then driven by the host over IPC.
 *
 * @param {ModuleEventEmitter} rpc - HRPC instance (used to emit moduleEvent)
 * @param {RpcContext} context - Shared context (moduleManagers, capabilities)
 */
function createModuleRuntime (rpc, context) {
  // Instances live on the context so lifecycle dispose can tear them down too.
  if (!context.moduleInstances) {
    context.moduleInstances = new Map()
  }
  const instances = context.moduleInstances // moduleName -> { mgr, instance, ready, error }

  const getManagers = () => context.moduleManagers || {}

  // Construct one module. The factory must consume `seed` synchronously so the
  // caller can zero it right after; readiness is then awaited by callModule.
  function construct (name, moduleConfig, seed) {
    const mgr = getManagers()[name]
    if (!mgr || typeof mgr.createModule !== 'function') {
      throw createErrorWithCode(`Unknown module: ${name}`, ERROR_CODES.BAD_REQUEST)
    }
    if (instances.has(name)) return instances.get(name).ready

    const emit = (event, payload) => {
      rpc.moduleEvent({
        module: name,
        event,
        payload: safeStringify(normalize(payload === undefined ? null : payload))
      })
    }

    const entry = { mgr, instance: null, ready: null, error: null }
    instances.set(name, entry)

    const wire = (instance) => {
      entry.instance = instance
      for (const ev of (Array.isArray(mgr.events) ? mgr.events : [])) {
        if (instance && typeof instance.on === 'function') {
          instance.on(ev, (payload) => emit(ev, payload))
        }
      }
      logger.info(`Module constructed: ${name}`)
      return instance
    }

    let result
    try {
      result = mgr.createModule({
        seed: seed ?? null,
        config: moduleConfig ?? {},
        capabilities: context.capabilities || {},
        emit
      })
    } catch (err) {
      entry.error = err
      emit('error', toErrorPayload(err))
      throw err
    }

    if (result && typeof result.then === 'function') {
      entry.ready = result.then(wire).catch((err) => {
        entry.error = err
        logger.error(`Module construction failed: ${name}: ${err && err.message}`)
        emit('error', toErrorPayload(err))
        throw err
      })
    } else {
      entry.ready = Promise.resolve(wire(result))
    }
    return entry.ready
  }

  // Construct all configured modules. The seed is safe to zero once this returns
  // (each factory consumed it synchronously); returns readiness promises.
  function constructFromConfig (modulesConfig, seed) {
    const pendings = []
    for (const [name, moduleConfig] of Object.entries(modulesConfig || {})) {
      try {
        const ready = construct(name, moduleConfig, seed)
        if (ready && typeof ready.then === 'function') pendings.push(ready.catch(() => {}))
      } catch (err) {
        logger.error(`Module construction failed (sync): ${name}: ${err && err.message}`)
      }
    }
    return pendings
  }

  async function resolveInstance (name) {
    const entry = instances.get(name)
    if (!entry) return null
    if (!entry.instance && entry.ready) {
      try { await entry.ready } catch { return null }
    }
    return entry.instance
  }

  async function callModuleHandler (req) {
    let args
    validateRequest(
      req,
      () => {
        validateNonEmptyString(req.module, 'module')
        validateNonEmptyString(req.method, 'method')
        args = req.args ? validateJSON(req.args, 'args') : []
      },
      'callModule'
    )

    const entry = instances.get(req.module)
    if (entry && entry.error) {
      throw createErrorWithCode(
        `Module "${req.module}" failed to initialize: ${entry.error.message}`,
        ERROR_CODES.WDK_MANAGER_INIT
      )
    }

    const instance = await resolveInstance(req.module)
    if (!instance) {
      throw createErrorWithCode(`Module not initialized: ${req.module}`, ERROR_CODES.BAD_REQUEST)
    }

    const fn = instance[req.method]
    if (typeof fn !== 'function') {
      throw createErrorWithCode(`Method not found: ${req.module}.${req.method}`, ERROR_CODES.BAD_REQUEST)
    }

    // Array args spread as positional; non-array passed as a single argument.
    const argsArray = Array.isArray(args) ? args : (args !== null && args !== undefined ? [args] : [])
    let result = await fn.apply(instance, argsArray)
    result = await materialize(result) // stream / async-iterable -> array
    return { result: safeStringify(normalize(result)) } // Buffer/Uint8Array -> hex
  }

  // Close every hosted module (WDK dispose / lock).
  async function closeAll () {
    for (const [name, entry] of instances) {
      try { if (entry.ready) await entry.ready } catch { /* failed construction */ }
      try {
        if (entry.instance && typeof entry.instance.close === 'function') await entry.instance.close()
      } catch (err) {
        logger.warn(`Module close failed during dispose: ${name}: ${err && err.message}`)
      }
    }
    instances.clear()
  }

  // Suspend / resume every hosted module, driven by the worklet's Bare lifecycle.
  async function suspendAll () {
    for (const entry of instances.values()) {
      if (!entry.instance || typeof entry.instance.suspend !== 'function') continue
      try { await entry.instance.suspend() } catch (err) { logger.warn(`Module suspend failed: ${err && err.message}`) }
    }
  }

  async function resumeAll () {
    for (const entry of instances.values()) {
      if (!entry.instance || typeof entry.instance.resume !== 'function') continue
      try { await entry.instance.resume() } catch (err) { logger.warn(`Module resume failed: ${err && err.message}`) }
    }
  }

  return {
    construct,
    constructFromConfig,
    callModule: callModuleHandler,
    closeAll,
    suspendAll,
    resumeAll
  }
}

async function materialize (value) {
  if (value && typeof value.toArray === 'function') return value.toArray()
  return value
}

// Serialize an error into a payload app devs can handle (name + message + stack).
function toErrorPayload (err) {
  return err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { name: 'Error', message: String(err) }
}

function normalize (value) {
  if (value === null || value === undefined) return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = normalize(value[k])
    return out
  }
  return value
}

module.exports = {
  createModuleRuntime
}
