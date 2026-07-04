#!/usr/bin/env node

/**
 * Generates Swift HRPC packages from the same hyperschema state used by
 * scripts/generate-hrpc.js. Run gen:hrpc first (or let this script do it)
 * so generated/schema holds the current schema state.
 *
 * Outputs two local SPM packages:
 * - generated/swift/schema (Schema.swift + Package.swift + schema.json)
 * - generated/swift/hrpc   (HRPC.swift + Package.swift + hrpc.json)
 *
 * Command IDs and schema versions come from the shared state files, so the
 * Swift peer stays wire-compatible with generated/hrpc/index.js.
 */

const fs = require('fs')
const path = require('path')
const SwiftHyperschema = require('hyperschema-swift')
const SwiftHRPC = require('hrpc-swift')

const schemaDir = path.join(__dirname, '../generated/schema')
const hrpcJsonPath = path.join(__dirname, '../src/hrpc/hrpc.json')
const swiftSchemaDir = path.join(__dirname, '../generated/swift/schema')
const swiftHrpcDir = path.join(__dirname, '../generated/swift/hrpc')

// hrpc-swift only accepts kebab-case handler names (@ns/kebab-name), while the
// JS compiler accepts the camelCase names used in src/hrpc/hrpc.json. Handler
// names are local dispatch keys — the wire protocol uses the numeric command
// ids — so renaming here keeps the Swift peer wire-compatible with the JS one.
function kebabHandlerName(name) {
  const [ns, method] = name.split('/')
  return ns + '/' + method.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

const hrpcJson = JSON.parse(fs.readFileSync(hrpcJsonPath, 'utf8'))
for (const def of hrpcJson.schema) def.name = kebabHandlerName(def.name)

const schema = SwiftHyperschema.from(schemaDir)
const hrpc = SwiftHRPC.from(schemaDir, hrpcJson)

SwiftHyperschema.toDisk(schema, swiftSchemaDir)
console.log('Wrote Swift schema package to', swiftSchemaDir)

SwiftHRPC.toDisk(hrpc, swiftHrpcDir, {
  schemaPackagePath: '../schema',
  schemaPackageName: 'Schema',
  schemaPackageId: 'schema'
})
console.log('Wrote Swift HRPC package to', swiftHrpcDir)
