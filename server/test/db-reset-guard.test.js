const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeDemoReset, assertSafeDemoSeed } = require('../src/db-reset-guard');

test('destructive reset requires an explicit confirmation', () => {
  assert.throws(
    () => assertSafeDemoReset({ databaseName: 'smartabs_demo', nodeEnv: 'development', confirmed: false }),
    /Reset dibatalkan/
  );
});

test('destructive reset is restricted to the demo database and non-production', () => {
  assert.throws(
    () => assertSafeDemoReset({ databaseName: 'smartabs', nodeEnv: 'development', confirmed: true }),
    /DB_NAME=smartabs_demo/
  );
  assert.throws(
    () => assertSafeDemoReset({ databaseName: 'smartabs_demo', nodeEnv: 'production', confirmed: true }),
    /NODE_ENV=production/
  );
  assert.doesNotThrow(
    () => assertSafeDemoReset({ databaseName: 'smartabs_demo', nodeEnv: 'development', confirmed: true })
  );
});

test('demo seed is restricted to the demo database and non-production', () => {
  assert.throws(
    () => assertSafeDemoSeed({ databaseName: 'smartabs', nodeEnv: 'development' }),
    /DB_NAME=smartabs_demo/
  );
  assert.throws(
    () => assertSafeDemoSeed({ databaseName: 'smartabs_demo', nodeEnv: 'production' }),
    /NODE_ENV=production/
  );
  assert.doesNotThrow(
    () => assertSafeDemoSeed({ databaseName: 'smartabs_demo', nodeEnv: 'development' })
  );
});
