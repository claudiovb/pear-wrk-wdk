#!/usr/bin/env node

/**
 * Generates the RPC code from schema.json and src/hrpc/hrpc.json.
 * Each generator in scripts/generators writes one transport:
 * - generators/hrpc.js: generated/hrpc and generated/schema
 * - generators/bare-rpc.js: generated/bare-rpc
 */

const fs = require('fs')
const path = require('path')
const generateHrpc = require('./generators/hrpc')
const generateBareRpc = require('./generators/bare-rpc')

const rootDir = path.join(__dirname, '..')
const generatedDir = path.join(rootDir, 'generated')
const hrpcDir = path.join(rootDir, 'src/hrpc')

// Read schema.json and hrpc.json
const schemaData = JSON.parse(fs.readFileSync(path.join(rootDir, 'schema.json'), 'utf8'))
const hrpcData = JSON.parse(fs.readFileSync(path.join(hrpcDir, 'hrpc.json'), 'utf8'))

generateHrpc({
  schemaData,
  schemaDir: path.join(generatedDir, 'schema'),
  hrpcDir,
  outputDir: path.join(generatedDir, 'hrpc')
})

generateBareRpc({
  schemaData,
  hrpcData,
  outputDir: path.join(generatedDir, 'bare-rpc')
})

console.log('Schemas generation complete!')
