const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('payment-fulfillment-recovery.test');

  process.env.PAYPAL_CLIENT_ID = 'paypal-client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'paypal-client-secret';
  process.env.PAYPAL_BASE_URL = 'https://paypal.example.test';
  process.env.WHISHPAY_CHANNEL = 'whish-channel';
  process.env.WHISHPAY_SECRET = 'whish-secret';
  process.env.WHISHPAY_BASE_URL = 'https://whish.example.test';
  process.env.WHISHPAY_WEBSITE_URL = 'https://app.freecvaudit.test';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  await runStore.upsertRun('recovery_run', {
    revised_cv_text: 'Recovery Candidate\nEXPERIENCE\n- Added resilient fulfillment handling',
  });

  global.fetch = async (url) => {
    if (String(url).includes('/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'paypal-token' }) };
    }
    if (String(url).includes('/capture')) {
      return { ok: true, status: 200, json: async () => ({ id: 'CAPTURE_1', status: 'COMPLETED' }) };
    }
    throw new Error(`Unexpected PayPal fetch URL: ${url}`);
  };

  clearModule('../netlify/functions/paypal-utils');
  clearModule('../netlify/functions/paypal-capture-order');
  const paypalCaptureOrder = require('../netlify/functions/paypal-capture-order').handler;

  const paypalResponse = await paypalCaptureOrder({
    httpMethod: 'POST',
    body: JSON.stringify({
      orderID: 'ORDER_RECOVERY_1',
      runId: 'recovery_run',
      email: 'recover-paypal@example.com',
    }),
  });
  assert.strictEqual(paypalResponse.statusCode, 200);
  const paypalPayload = JSON.parse(paypalResponse.body || '{}');
  assert.ok(paypalPayload.fulfillmentId, 'PayPal capture should create fulfillment when missing.');
  const paypalFulfillment = await runStore.getFulfillment(paypalPayload.fulfillmentId);
  assert.ok(paypalFulfillment, 'Created PayPal fulfillment should be retrievable.');
  assert.strictEqual(paypalFulfillment.payment_status, 'PAID');
  assert.strictEqual(paypalFulfillment.provider_order_id, 'ORDER_RECOVERY_1');
  assert.strictEqual(paypalFulfillment.email, 'recover-paypal@example.com');
  const statsAfterPaypal = await runStore.getOperationalStats();
  assert.ok(statsAfterPaypal.fulfillmentQueue.pending >= 1 || statsAfterPaypal.fulfillmentQueue.total >= 1);

  const queueBeforePaypalRetry = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  const paypalResponseRetry = await paypalCaptureOrder({
    httpMethod: 'POST',
    body: JSON.stringify({
      orderID: 'ORDER_RECOVERY_1',
      runId: 'recovery_run',
      email: 'recover-paypal@example.com',
    }),
  });
  assert.strictEqual(paypalResponseRetry.statusCode, 200);
  const paypalPayloadRetry = JSON.parse(paypalResponseRetry.body || '{}');
  assert.strictEqual(paypalPayloadRetry.fulfillmentId, paypalPayload.fulfillmentId);
  const queueAfterPaypalRetry = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  assert.ok(queueAfterPaypalRetry >= queueBeforePaypalRetry + 1, 'Duplicate PayPal events should still enqueue fulfillment when needed.');

  await runStore.updateFulfillment(paypalPayload.fulfillmentId, { email_status: 'SENT' });
  const queueBeforePaypalSentDuplicate = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  const paypalSentDuplicateResponse = await paypalCaptureOrder({
    httpMethod: 'POST',
    body: JSON.stringify({
      orderID: 'ORDER_RECOVERY_1',
      runId: 'recovery_run',
      email: 'recover-paypal@example.com',
    }),
  });
  assert.strictEqual(paypalSentDuplicateResponse.statusCode, 200);
  const queueAfterPaypalSentDuplicate = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  assert.strictEqual(queueAfterPaypalSentDuplicate, queueBeforePaypalSentDuplicate, 'Duplicate PayPal callbacks should be ignored once email is sent.');


  global.fetch = async (url) => {
    if (String(url).includes('/payment/collect/status')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true, data: { collectStatus: 'PAID' } }),
      };
    }
    throw new Error(`Unexpected Whish fetch URL: ${url}`);
  };

  clearModule('../netlify/functions/whishpay-utils');
  clearModule('../netlify/functions/whishpay-check-status');
  const whishpayCheckStatus = require('../netlify/functions/whishpay-check-status').handler;

  const whishResponse = await whishpayCheckStatus({
    httpMethod: 'POST',
    body: JSON.stringify({
      externalId: 'WHISH_RECOVERY_1',
      runId: 'recovery_run',
      email: 'recover-whish@example.com',
    }),
  });
  assert.strictEqual(whishResponse.statusCode, 200);
  const whishPayload = JSON.parse(whishResponse.body || '{}');
  assert.strictEqual(whishPayload.isPaidStatus, true);
  assert.ok(whishPayload.fulfillmentId, 'Whish status confirmation should create fulfillment when missing.');
  const whishFulfillment = await runStore.getFulfillment(whishPayload.fulfillmentId);
  assert.ok(whishFulfillment, 'Created Whish fulfillment should be retrievable.');
  assert.strictEqual(whishFulfillment.payment_status, 'PAID');
  assert.strictEqual(whishFulfillment.provider_order_id, 'WHISH_RECOVERY_1');
  assert.strictEqual(whishFulfillment.email, 'recover-whish@example.com');
  const statsAfterWhish = await runStore.getOperationalStats();
  assert.ok(statsAfterWhish.fulfillmentQueue.total >= 1);

  const queueBeforeWhishRetry = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  const whishResponseRetry = await whishpayCheckStatus({
    httpMethod: 'POST',
    body: JSON.stringify({
      externalId: 'WHISH_RECOVERY_1',
      runId: 'recovery_run',
      email: 'recover-whish@example.com',
    }),
  });
  assert.strictEqual(whishResponseRetry.statusCode, 200);
  const whishPayloadRetry = JSON.parse(whishResponseRetry.body || '{}');
  assert.strictEqual(whishPayloadRetry.fulfillmentId, whishPayload.fulfillmentId);
  const queueAfterWhishRetry = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  assert.ok(queueAfterWhishRetry >= queueBeforeWhishRetry + 1, 'Duplicate Whish events should still enqueue fulfillment when needed.');

  await runStore.updateFulfillment(whishPayload.fulfillmentId, { email_status: 'SENT' });
  const queueBeforeWhishSentDuplicate = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  const whishSentDuplicateResponse = await whishpayCheckStatus({
    httpMethod: 'POST',
    body: JSON.stringify({
      externalId: 'WHISH_RECOVERY_1',
      runId: 'recovery_run',
      email: 'recover-whish@example.com',
    }),
  });
  assert.strictEqual(whishSentDuplicateResponse.statusCode, 200);
  const queueAfterWhishSentDuplicate = (await runStore.getOperationalStats()).fulfillmentQueue.total;
  assert.strictEqual(queueAfterWhishSentDuplicate, queueBeforeWhishSentDuplicate, 'Duplicate Whish callbacks should be ignored once email is sent.');


  console.log('payment fulfillment recovery test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
