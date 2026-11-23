#!/usr/bin/env node

/**
 * Generates the RPC code from schema.json and src/hrpc/hrpc.json.
 * Each generator in scripts/generators writes one transport:
 * - generators/hrpc.js: generated/hrpc and generated/schema
 */

const fs = require('fs')
const path = require('path')
const generateHrpc = require('./generators/hrpc')

const rootDir = path.join(__dirname, '..')
const generatedDir = path.join(rootDir, 'generated')

// Read schema.json
const schemaData = JSON.parse(fs.readFileSync(path.join(rootDir, 'schema.json'), 'utf8'))

generateHrpc({
  schemaData,
  schemaDir: path.join(generatedDir, 'schema'),
  hrpcDir: path.join(rootDir, 'src/hrpc'),
  outputDir: path.join(generatedDir, 'hrpc')
})

console.log('Schemas generation complete!')
