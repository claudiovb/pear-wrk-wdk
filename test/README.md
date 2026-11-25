# Tests

This directory contains tests for the WDK worklet.

## Test Structure

Over the transports, as a host sees them:

- `transports.test.js` - Every command over each transport (`HRPC` and `BareRPC`), with the full handler set behind an in-memory pipe. A case added here runs on both.
- `bare-rpc.test.js` - What is specific to the `bare-rpc` transport: the JSON payloads, the buffer fields, the frame limit, and that nothing a peer sends or a handler throws ends the worklet
- `modules-hrpc.test.js` - The module subsystem over HRPC

The entry and the exports:

- `start.test.js` - `createStart`: the entry `bare-stow` runs, and the `stop` it returns
- `stow.test.js` - `createServerProvider`: the module each provider generates for `bare-stow`
- `exports.test.js` - What each export of the package gives, and that neither brings in a transport it does not serve
- `stow.smoke.js` - Smoke test of the worklet under Bare (see below)

The handlers and the utilities, without a transport:

- `rpc-handlers.test.js` - Unit tests for RPC handlers
- `modules.test.js` - Unit tests for the module runtime
- `rpc-exception.test.js` - The structured error returned to the host
- `crypto.test.js`, `secret-scope.test.js`, `validation.test.js`, `logger.test.js`, `handle-leak-check.test.js` - Unit tests for the utilities

Support files:

- `setup.js` - Test setup that mocks bare-crypto for Node.js testing
- `helpers/pipe-pair.js` - Two connected in-memory streams, standing in for the IPC between a host and a worklet
- `fixtures/stow/entry.js` - The worklet entry the smoke test packs
- `test-lightning.js` - Integration test for Lightning invoice generation
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

### Smoke Test Under Bare

Run the smoke test, once for each transport:
```bash
npm run test:stow
```

The test file itself runs in Node and plays the host. The worklet it tests runs in Bare: the test packs `fixtures/stow/entry.js` into `fixtures/stow/out/` (git-ignored) with `bare-stow`, starts the bundle as a separate Bare process with `bare-sidecar`, and calls it over the IPC between the two. So the handlers, the crypto (`bare-crypto`, not the mock of `setup.js`) and the transport's server side all run under Bare.

It is not part of `npm test` because it starts processes and takes a few seconds; the build workflow runs both. The Bare runtime comes with `bare-sidecar`, so nothing has to be installed globally.

The apps run the worklet with `bare-kit`, not `bare-sidecar`. `bare-stow` only generates the `bare-kit` harness for Swift and Kotlin, so `bare-sidecar` is the target a Node host can start. The code under test is the same on every target: the entry, the module of the server provider, the handlers and `stop`.

## Test Setup

The test setup (`setup.js`) mocks `bare-crypto` to use Node's built-in `crypto` module, allowing tests to run in Node.js without requiring the Bare runtime. This enables faster unit testing, while the smoke test runs the same code in the full Bare environment.

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

A test that needs a command to behave the same on both transports belongs in `transports.test.js`.

## Prerequisites

The generated RPC code is committed. After changing `schema.json` or `src/hrpc/hrpc.json`, generate it again:
```bash
npm run gen:rpcs
```
