const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('fulfillment-queue.test');
  process.env.RESEND_API_KEY = 'fulfillment-queue-key';
  process.env.URL = 'https://app.freecvaudit.com';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'fulfillment_queue_run';
  await runStore.upsertRun(runId, {
    revised_cv_text: 'Queue Candidate\nEXPERIENCE\n- Reliable delivery',
  });

  const fulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'queue@example.com',
    provider: 'paypal',
    provider_order_id: 'queue_order_1',
    payment_status: 'PAID',
  });

  await runStore.enqueueFulfillmentJob({
    fulfillmentId: fulfillment.fulfillment_id,
    email: 'queue@example.com',
    name: 'Queue User',
    forceSync: true,
  });

  let sendCount = 0;
  global.fetch = async () => {
    sendCount += 1;
    return { ok: true, status: 200, json: async () => ({ id: `fulfillment_email_${sendCount}` }) };
  };

  clearModule('../netlify/functions/send-cv-email');
  clearModule('../netlify/functions/process-fulfillment-queue');
  const handler = require('../netlify/functions/process-fulfillment-queue').handler;

  process.env.QUEUE_PROCESSOR_SECRET = 'queue-secret';
  const forbiddenResponse = await handler({ httpMethod: 'POST', headers: {} });
  assert.strictEqual(forbiddenResponse.statusCode, 403);

  const response = await handler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer queue-secret' },
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.processed[0].status, 'COMPLETED');
  assert.strictEqual(sendCount, 1);

  const updatedFulfillment = await runStore.getFulfillment(fulfillment.fulfillment_id);
  assert.strictEqual(updatedFulfillment.email_status, 'SENT');


  await runStore.enqueueFulfillmentJob({
    fulfillmentId: fulfillment.fulfillment_id,
    email: 'queue@example.com',
    name: 'Queue User',
    forceSync: true,
  });
  const duplicateResponse = await handler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer queue-secret' },
  });
  const duplicatePayload = JSON.parse(duplicateResponse.body || '{}');
  assert.strictEqual(duplicatePayload.processed[0].duplicate, true, 'Already-sent fulfillments should be short-circuited.');
  assert.strictEqual(sendCount, 1, 'Duplicate fulfillment jobs should not send duplicate emails.');

  const pending = await runStore.createFulfillment({
    run_id: runId,
    email: 'pendingqueue@example.com',
    provider: 'paypal',
    provider_order_id: 'queue_order_2',
    payment_status: 'PENDING',
  });
  await runStore.enqueueFulfillmentJob({
    fulfillmentId: pending.fulfillment_id,
    email: 'pendingqueue@example.com',
    name: 'Pending Queue',
    forceSync: true,
  });
  const pendingResponse = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const pendingPayload = JSON.parse(pendingResponse.body || '{}');
  assert.strictEqual(pendingPayload.processed[0].status, 'RETRY');

  delete process.env.QUEUE_PROCESSOR_SECRET;

  console.log('fulfillment queue test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
