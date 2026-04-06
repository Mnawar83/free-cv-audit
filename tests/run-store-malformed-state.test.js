const assert = require('assert');
const fs = require('fs/promises');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('run-store-malformed-state.test');

  // Simulate a malformed/legacy store that is missing several object collections.
  await fs.writeFile(process.env.RUN_STORE_PATH, JSON.stringify({}), 'utf8');

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const missingRun = await runStore.getRun('does_not_exist');
  assert.strictEqual(missingRun, null, 'getRun should not throw when persisted store state is malformed.');

  const fulfillment = await runStore.createFulfillment({
    run_id: 'malformed_state_run',
    email: 'user@example.com',
    provider: 'paypal',
    provider_order_id: 'ORDER_MALFORMED',
    payment_status: 'PENDING',
  });

  assert.ok(fulfillment && fulfillment.fulfillment_id, 'Fulfillment should be created even when store shape is malformed.');
  const stored = await runStore.getFulfillment(fulfillment.fulfillment_id);
  assert.ok(stored, 'Created fulfillment should be retrievable.');

  const run = await runStore.upsertRun('malformed_state_run', { checkout_provider_hint: 'paypal' });
  assert.strictEqual(run.checkout_provider_hint, 'paypal');

  console.log('run-store malformed state test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
