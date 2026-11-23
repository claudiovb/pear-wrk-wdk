# Tests

This directory contains tests for the WDK worklet.

## Test Structure

- `rpc-handlers.test.js` - Unit tests for RPC handlers
- `test-lightning.js` - Integration test for Lightning invoice generation
- `setup.js` - Test setup that mocks bare-crypto for Node.js testing
- `config/networks.json` - Network configuration for integration tests

## Running Tests

### Unit Tests

Run all unit tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Run a specific test file:
```bash
node --test test/rpc-handlers.test.js
```

### Integration Tests

Run the Lightning integration test:
```bash
bare test/test-lightning.js
```

## Test Setup

The test setup (`setup.js`) mocks `bare-crypto` to use Node's built-in `crypto` module, allowing tests to run in Node.js without requiring the Bare runtime. This enables faster unit testing while integration tests can still run in the full Bare environment.

## Writing Tests

Tests use Node's built-in test runner (available in Node.js 18+). Example:

```javascript
const { test, describe } = require('node:test')
const assert = require('node:assert')

describe('My Feature', () => {
  test('should do something', () => {
    assert.strictEqual(1 + 1, 2)
  })
})
```

## Prerequisites

Before running tests, ensure generated files exist:
```bash
npm run gen:wallet-modules
npm run gen:rpcs
```

