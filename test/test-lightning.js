#!/usr/bin/env bare

/**
 * Test script to generate a Lightning invoice using the worklet
 *
 * Usage:
 *   bare test/test-lightning.js
 *
 * Or with a custom seed phrase:
 *   bare test/test-lightning.js "word1 word2 ... word12"
 */

// Provide BareKit global before loading the worklet
const IPC = require('bare-ipc')

// Create a pair of connected IPC ports
const [workletPort, clientPort] = IPC.open()

// Create IPC instances from the ports
const workletIPC = workletPort.connect()
const clientIPC = clientPort.connect()

// Provide BareKit global with the IPC instance for the worklet
global.BareKit = {
  IPC: workletIPC
}

// Load the worklet
require('../src/wdk-worklet.js')

// Create HRPC client
const HRPC = require('../generated/hrpc/index.js')
const hrpc = new HRPC(clientIPC)

const fs = require('fs')
const path = require('path')

// Get seed phrase from command line or use default test seed
const seedPhrase = process.argv[2] || 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Load network configurations from external config file
// Can be overridden via TEST_NETWORK_CONFIG environment variable
const networkConfigPath = process.env.TEST_NETWORK_CONFIG || path.join(__dirname, 'config/networks.json')
let networkConfigs

try {
  const configData = fs.readFileSync(networkConfigPath, 'utf8')
  networkConfigs = JSON.parse(configData)
} catch (error) {
  console.error(`Failed to load network config from ${networkConfigPath}:`, error.message)
  console.error('Please ensure the config file exists or set TEST_NETWORK_CONFIG environment variable')
  process.exit(1)
}

async function testLightningInvoice () {
  try {
    console.log('⚡ Testing Lightning Invoice Generation\n')
    console.log(`Using seed phrase: ${seedPhrase.split(' ').slice(0, 3).join(' ')}... (${seedPhrase.split(' ').length} words)\n`)

    // Step 1: Initialize the worklet
    console.log('📝 Step 1: Initializing worklet...')
    const initResult = await hrpc.workletStart({
      seedPhrase,
      config: JSON.stringify(networkConfigs)
    })
    console.log('✓ Worklet initialized:', initResult)
    console.log('')

    // Step 2: Generate Lightning invoice
    console.log('⚡ Step 2: Generating Lightning invoice...')
    console.log('   (This uses the Spark network to create a Lightning invoice)\n')

    const result = await hrpc.getAddress({
      network: 'lightning',
      accountIndex: 0
    })

    console.log('✅ Lightning Invoice Generated Successfully!\n')
    console.log('='.repeat(70))
    console.log('INVOICE:')
    console.log(result.address)

    // Step 3: Cleanup
    console.log('🧹 Cleaning up...')
    const { status } = await hrpc.dispose({})
    if (status !== 'disposed') {
      throw new Error(`Unexpected dispose status: ${status}`)
    }
    console.log('✓ Worklet disposed\n')

    console.log('✅ Test completed successfully!')
  } catch (error) {
    console.error('\n❌ Error during test:')
    console.error(error.message)
    if (error.stack) {
      console.error('\nStack trace:')
      console.error(error.stack)
    }

    // Try to cleanup on error
    try {
      await hrpc.dispose({})
    } catch (e) {
      // Ignore cleanup errors
    }

    process.exit(1)
  }
}

// Run the test
testLightningInvoice().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
