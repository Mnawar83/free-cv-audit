const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('checkout-run-bootstrap.test');

  process.env.PAYPAL_CLIENT_ID = 'paypal-client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'paypal-client-secret';
  process.env.PAYPAL_BASE_URL = 'https://paypal.example.test';
  process.env.WHISHPAY_CHANNEL = 'whish-channel';
  process.env.WHISHPAY_SECRET = 'whish-secret';
  process.env.WHISHPAY_WEBSITE_URL = 'https://app.freecvaudit.test';
  process.env.WHISHPAY_BASE_URL = 'https://whish.example.test';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  let paypalFetchCalls = 0;
  global.fetch = async (url) => {
    paypalFetchCalls += 1;
    if (String(url).includes('/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'token_123' }) };
    }
    if (String(url).includes('/v2/checkout/orders')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'ORDER_123', links: [{ rel: 'approve', href: 'https://paypal.example.test/approve' }] }),
      };
    }
    throw new Error(`Unexpected PayPal fetch URL: ${url}`);
  };

  clearModule('../netlify/functions/paypal-utils');
  clearModule('../netlify/functions/paypal-create-order');
  const paypalCreateOrder = require('../netlify/functions/paypal-create-order').handler;
  const paypalRunId = 'run_bootstrap_paypal';
  const paypalMissingRunResponse = await paypalCreateOrder({
    httpMethod: 'POST',
    body: JSON.stringify({ runId: paypalRunId, email: 'paypal@example.com' }),
  });
  assert.strictEqual(paypalMissingRunResponse.statusCode, 404);

  await runStore.upsertRun(paypalRunId, { original_cv_text: 'CV text' });
  const paypalResponse = await paypalCreateOrder({
    httpMethod: 'POST',
    body: JSON.stringify({ runId: paypalRunId, email: 'paypal@example.com' }),
  });
  assert.strictEqual(paypalResponse.statusCode, 200);
  assert.strictEqual(paypalFetchCalls, 2);

  global.fetch = async (url) => {
    if (String(url).includes('/payment/whish')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true, data: { collectUrl: 'https://whish.example.test/collect' } }),
      };
    }
    throw new Error(`Unexpected Whish fetch URL: ${url}`);
  };

  clearModule('../netlify/functions/whishpay-utils');
  clearModule('../netlify/functions/whishpay-create-payment');
  const whishpayCreatePayment = require('../netlify/functions/whishpay-create-payment').handler;
  const whishRunId = 'run_bootstrap_whish';
  const whishMissingRunResponse = await whishpayCreatePayment({
    httpMethod: 'POST',
    body: JSON.stringify({ runId: whishRunId, email: 'whish@example.com' }),
  });
  assert.strictEqual(whishMissingRunResponse.statusCode, 404);

  await runStore.upsertRun(whishRunId, { original_cv_text: 'CV text' });
  const whishResponse = await whishpayCreatePayment({
    httpMethod: 'POST',
    body: JSON.stringify({ runId: whishRunId, email: 'whish@example.com' }),
  });
  assert.strictEqual(whishResponse.statusCode, 200);

  console.log('checkout run existence validation test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
