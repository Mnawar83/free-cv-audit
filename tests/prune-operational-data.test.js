const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('prune-operational-data.test');
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  await runStore.upsertEmailDownload('expired-token', {
    revised_cv_text: 'Old data',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await runStore.markWebhookEventProcessed('evt-old', 1);
  await runStore.markPaymentEventProcessed('paypal', 'evt-payment-old', 'payload');
  const oldFulfillment = await runStore.createFulfillment({
    run_id: 'old_run',
    email: 'old@example.com',
    provider: 'paypal',
    provider_order_id: 'order_old',
    payment_status: 'PAID',
  });
  await runStore.updateFulfillment(oldFulfillment.fulfillment_id, {
    updated_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  const pruneResult = await runStore.pruneOperationalData({
    deadLetterRetentionMs: 1,
    completedRetentionMs: 1,
    paymentEventRetentionMs: 1,
    fulfillmentRetentionMs: 1,
  });
  assert.ok(pruneResult.removedDownloads >= 1);
  assert.ok(typeof pruneResult.removedWebhookEvents === 'number');
  assert.ok(pruneResult.removedPaymentEvents >= 1);
  assert.ok(pruneResult.removedFulfillments >= 1);

  const downloadAfterPrune = await runStore.getEmailDownload('expired-token');
  assert.strictEqual(downloadAfterPrune, null);

  clearModule('../netlify/functions/prune-operational-data-scheduled');
  const scheduled = require('../netlify/functions/prune-operational-data-scheduled');
  assert.ok(scheduled.config?.schedule);
  const scheduledResponse = await scheduled.handler();
  assert.strictEqual(scheduledResponse.statusCode, 200);

  console.log('prune-operational-data test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
