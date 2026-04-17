const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('provider-subscription-webhooks.test');
  process.env.PAYPAL_WEBHOOK_SHARED_SECRET = 'paypal-secret';
  process.env.WHISHPAY_WEBHOOK_SHARED_SECRET = 'whish-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const user = await runStore.upsertUserByEmail('provider@example.com', {});

  clearModule('../netlify/functions/paypal-subscription-webhook');
  const paypalHandler = require('../netlify/functions/paypal-subscription-webhook').handler;

  const paypalResponse = await paypalHandler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': 'paypal-secret',
    },
    body: JSON.stringify({
      event_type: 'BILLING.SUBSCRIPTION.RENEWED',
      resource: {
        id: 'sub_paypal_1',
        custom_id: user.user_id,
        plan_id: 'pro',
      },
    }),
  });
  assert.strictEqual(paypalResponse.statusCode, 200);

  clearModule('../netlify/functions/whishpay-subscription-webhook');
  const whishHandler = require('../netlify/functions/whishpay-subscription-webhook').handler;

  const whishResponse = await whishHandler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': 'whish-secret',
    },
    body: JSON.stringify({
      subscriptionId: 'sub_whish_1',
      userId: user.user_id,
      plan: 'team',
      status: 'active',
    }),
  });
  assert.strictEqual(whishResponse.statusCode, 200);

  const entitlements = await runStore.getUserEntitlements(user.user_id);
  assert.strictEqual(entitlements.plan, 'team');

  console.log('provider subscription webhooks test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
