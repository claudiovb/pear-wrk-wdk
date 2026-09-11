const test = require('node:test')
const assert = require('node:assert/strict')

const { validateJSON } = require('../src/utils/validation')

test('validateJSON does not expose invalid input in its error', () => {
  const secretPrefix = 'abandon ability able about'

  assert.throws(
    () => validateJSON(secretPrefix, 'args'),
    (error) => {
      assert.strictEqual(error.message, 'args must be valid JSON')
      assert.ok(!error.message.includes(secretPrefix))
      return true
    }
  )
})
