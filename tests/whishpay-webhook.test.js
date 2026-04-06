const assert = require('assert');
const crypto = require('crypto');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('whishpay-webhook.test');
  process.env.WHISHPAY_WEBHOOK_SHARED_SECRET = 'whish-secret';
  process.env.RESEND_API_KEY = 'whish-webhook-resend';
  process.env.URL = 'https://app.freecvaudit.com';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  await runStore.upsertRun('whish_webhook_run', {
    revised_cv_text: 'Whish Candidate\nEXPERIENCE\n- Verified by webhook',
  });
  const fulfillment = await runStore.createFulfillment({
    run_id: 'whish_webhook_run',
    email: 'whish@example.com',
    provider: 'whishpay',
    provider_order_id: '789123',
    payment_status: 'PENDING',
  });

  clearModule('../netlify/functions/whishpay-webhook');
  const handler = require('../netlify/functions/whishpay-webhook').handler;
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'whish-secret' },
    body: JSON.stringify({
      eventId: 'wh_evt_1',
      externalId: '789123',
      collectStatus: 'PAID',
      transactionId: 'txn_1',
    }),
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.paid, true);
  assert.strictEqual(payload.fulfillmentId, fulfillment.fulfillment_id);

  const updated = await runStore.getFulfillment(fulfillment.fulfillment_id);
  assert.strictEqual(updated.payment_status, 'PAID');

  process.env.QUEUE_PROCESSOR_SECRET = 'whish-queue-secret';

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
    body: JSON.stringify({ eventId: 'wh_evt_2' }),
  });
  assert.strictEqual(badSecretResponse.statusCode, 401);

  const hmacBody = JSON.stringify({
    eventId: 'wh_evt_hmac_1',
    externalId: '789123',
    collectStatus: 'PAID',
    transactionId: 'txn_hmac_1',
  });
  const hmacTimestamp = String(Date.now());
  const hmacSignature = crypto
    .createHmac('sha256', process.env.WHISHPAY_WEBHOOK_SHARED_SECRET)
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
    .createHmac('sha256', process.env.WHISHPAY_WEBHOOK_SHARED_SECRET)
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

  // Verify webhooks are rejected when shared secret is not configured
  const savedSecret = process.env.WHISHPAY_WEBHOOK_SHARED_SECRET;
  delete process.env.WHISHPAY_WEBHOOK_SHARED_SECRET;
  clearModule('../netlify/functions/whishpay-webhook');
  const noSecretHandler = require('../netlify/functions/whishpay-webhook').handler;
  const noSecretResponse = await noSecretHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ eventId: 'wh_evt_no_secret', collectStatus: 'PAID' }),
  });
  assert.strictEqual(noSecretResponse.statusCode, 401, 'Webhooks must be rejected when WHISHPAY_WEBHOOK_SHARED_SECRET is not set');
  process.env.WHISHPAY_WEBHOOK_SHARED_SECRET = savedSecret;

  console.log('whishpay webhook test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
