const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('subscription-webhook.test');
  process.env.SUBSCRIPTION_WEBHOOK_SECRET = 'test-subscription-webhook-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const user = await runStore.upsertUserByEmail('billing@example.com', {});

  clearModule('../netlify/functions/subscription-webhook');
  const handler = require('../netlify/functions/subscription-webhook').handler;

  const renewResponse = await handler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': 'test-subscription-webhook-secret',
    },
    body: JSON.stringify({
      eventType: 'subscription.renewed',
      userId: user.user_id,
      subscriptionId: 'sub_renew_1',
      plan: 'pro',
      provider: 'billing-test',
    }),
  });
  assert.strictEqual(renewResponse.statusCode, 200);
  const renewPayload = JSON.parse(renewResponse.body || '{}');
  assert.strictEqual(renewPayload.entitlements.plan, 'pro');

  const cancelResponse = await handler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': 'test-subscription-webhook-secret',
    },
    body: JSON.stringify({
      eventType: 'subscription.canceled',
      userId: user.user_id,
      subscriptionId: 'sub_renew_1',
      plan: 'pro',
      provider: 'billing-test',
    }),
  });
  assert.strictEqual(cancelResponse.statusCode, 200);
  const cancelPayload = JSON.parse(cancelResponse.body || '{}');
  assert.strictEqual(cancelPayload.subscription.status, 'CANCELED');

  const unauthorized = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': 'wrong' },
    body: JSON.stringify({ userId: user.user_id, subscriptionId: 'sub_x' }),
  });
  assert.strictEqual(unauthorized.statusCode, 401);

  console.log('subscription webhook test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
