const assert = require('assert');
const crypto = require('crypto');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('paypal-webhook.test');
  process.env.PAYPAL_WEBHOOK_SHARED_SECRET = 'secret123';
  process.env.RESEND_API_KEY = 'paypal-webhook-resend';
  process.env.URL = 'https://app.freecvaudit.com';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  await runStore.upsertRun('paypal_webhook_run', {
    revised_cv_text: 'Webhook Candidate\nEXPERIENCE\n- Verified by webhook',
  });
  const fulfillment = await runStore.createFulfillment({
    run_id: 'paypal_webhook_run',
    email: 'webhook@example.com',
    provider: 'paypal',
    provider_order_id: 'ORDER-123',
    payment_status: 'PENDING',
  });

  clearModule('../netlify/functions/paypal-webhook');
  const handler = require('../netlify/functions/paypal-webhook').handler;
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'secret123' },
    body: JSON.stringify({
      id: 'evt_1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'capture_1',
        status: 'COMPLETED',
        supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
      },
    }),
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.isPaid, true);
  assert.strictEqual(payload.fulfillmentId, fulfillment.fulfillment_id);

  const updated = await runStore.getFulfillment(fulfillment.fulfillment_id);
  assert.strictEqual(updated.payment_status, 'PAID');

  process.env.QUEUE_PROCESSOR_SECRET = 'paypal-queue-secret';

  clearModule('../netlify/functions/process-fulfillment-queue');
  let sendCount = 0;
  global.fetch = async () => {
    sendCount += 1;
    return { ok: true, status: 200, json: async () => ({ id: `email_${sendCount}` }) };
  };
  const queueHandler = require('../netlify/functions/process-fulfillment-queue').handler;
  const queueResponse = await queueHandler({
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${process.env.QUEUE_PROCESSOR_SECRET}` },
  });
  const queuePayload = JSON.parse(queueResponse.body || '{}');
  assert.strictEqual(queuePayload.processed[0].status, 'COMPLETED');

  const badSecretResponse = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'wrong' },
    body: JSON.stringify({ id: 'evt_2' }),
  });
  assert.strictEqual(badSecretResponse.statusCode, 401);

  const hmacBody = JSON.stringify({
    id: 'evt_hmac_1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'capture_hmac_1',
      status: 'COMPLETED',
      supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
    },
  });
  const hmacTimestamp = String(Date.now());
  const hmacSignature = crypto
    .createHmac('sha256', process.env.PAYPAL_WEBHOOK_SHARED_SECRET)
    .update(`${hmacTimestamp}.${hmacBody}`)
    .digest('hex');
  const hmacResponse = await handler({
    httpMethod: 'POST',
    headers: {
      'x-webhook-timestamp': hmacTimestamp,
      'x-webhook-signature': hmacSignature,
    },
    body: hmacBody,
  });
  assert.strictEqual(hmacResponse.statusCode, 200);

  const staleTimestamp = String(Date.now() - 600_000);
  const staleSignature = crypto
    .createHmac('sha256', process.env.PAYPAL_WEBHOOK_SHARED_SECRET)
    .update(`${staleTimestamp}.${hmacBody}`)
    .digest('hex');
  const staleResponse = await handler({
    httpMethod: 'POST',
    headers: {
      'x-webhook-timestamp': staleTimestamp,
      'x-webhook-signature': staleSignature,
    },
    body: hmacBody,
  });
  assert.strictEqual(staleResponse.statusCode, 401);

  // Verify webhooks are allowed when shared secret is not configured (graceful fallback)
  const savedSecret = process.env.PAYPAL_WEBHOOK_SHARED_SECRET;
  delete process.env.PAYPAL_WEBHOOK_SHARED_SECRET;
  clearModule('../netlify/functions/paypal-webhook');
  const noSecretHandler = require('../netlify/functions/paypal-webhook').handler;
  const noSecretResponse = await noSecretHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ id: 'evt_no_secret', event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
  });
  assert.strictEqual(noSecretResponse.statusCode, 200, 'Webhooks must be allowed when PAYPAL_WEBHOOK_SHARED_SECRET is not set');
  process.env.PAYPAL_WEBHOOK_SHARED_SECRET = savedSecret;

  console.log('paypal webhook test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
