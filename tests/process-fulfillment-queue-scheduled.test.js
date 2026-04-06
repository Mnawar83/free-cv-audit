const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('process-fulfillment-queue-scheduled.test');
  process.env.RESEND_API_KEY = 'scheduled-fulfillment-resend';
  process.env.URL = 'https://app.freecvaudit.com';
  process.env.QUEUE_PROCESSOR_SECRET = 'scheduled-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'scheduled_fulfillment_run';
  await runStore.upsertRun(runId, {
    revised_cv_text: 'Scheduled Candidate\nEXPERIENCE\n- Cron tested',
  });
  const fulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'scheduled@example.com',
    provider: 'paypal',
    provider_order_id: 'scheduled_order_1',
    payment_status: 'PAID',
  });
  await runStore.enqueueFulfillmentJob({
    fulfillmentId: fulfillment.fulfillment_id,
    email: 'scheduled@example.com',
    name: 'Scheduled User',
    forceSync: true,
  });

  let sendCount = 0;
  global.fetch = async () => {
    sendCount += 1;
    return { ok: true, status: 200, json: async () => ({ id: `email_${sendCount}` }) };
  };

  clearModule('../netlify/functions/send-cv-email');
  clearModule('../netlify/functions/process-fulfillment-queue');
  clearModule('../netlify/functions/process-fulfillment-queue-scheduled');
  const handler = require('../netlify/functions/process-fulfillment-queue-scheduled').handler;
  const response = await handler();
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.processed[0].status, 'COMPLETED');
  assert.strictEqual(sendCount, 1);

  console.log('process-fulfillment-queue-scheduled test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
