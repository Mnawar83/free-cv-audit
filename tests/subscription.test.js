const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function extractCookieValue(setCookieHeader) {
  const firstPart = String(setCookieHeader || '').split(';')[0];
  const splitIndex = firstPart.indexOf('=');
  return splitIndex > 0 ? firstPart.slice(splitIndex + 1) : '';
}

async function run() {
  setupIsolatedRunStoreEnv('subscription.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/subscription');

  const userSession = require('../netlify/functions/user-session');
  const subscription = require('../netlify/functions/subscription');

  const createSessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'subscriber@example.com' }),
  });
  assert.strictEqual(createSessionResponse.statusCode, 200);
  const setCookie = createSessionResponse.headers['Set-Cookie'];
  const cookie = `__Host-cv_user_session=${extractCookieValue(setCookie)}`;

  const createSubscriptionResponse = await subscription.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ plan: 'pro', status: 'ACTIVE', provider: 'internal' }),
  });
  assert.strictEqual(createSubscriptionResponse.statusCode, 200);
  const createPayload = JSON.parse(createSubscriptionResponse.body || '{}');
  assert.strictEqual(createPayload.ok, true);
  assert.strictEqual(createPayload.subscription.plan, 'pro');
  assert.strictEqual(createPayload.entitlements.plan, 'pro');
  assert.strictEqual(createPayload.entitlements.canUseUnlimitedAudits, true);

  const getSubscriptionResponse = await subscription.handler({
    httpMethod: 'GET',
    headers: { cookie },
    body: '',
  });
  assert.strictEqual(getSubscriptionResponse.statusCode, 200);
  const getPayload = JSON.parse(getSubscriptionResponse.body || '{}');
  assert.strictEqual(getPayload.ok, true);
  assert.ok(Array.isArray(getPayload.subscriptions));
  assert.strictEqual(getPayload.subscriptions.length, 1);

  const noSessionResponse = await subscription.handler({
    httpMethod: 'GET',
    headers: {},
    body: '',
  });
  assert.strictEqual(noSessionResponse.statusCode, 401);

  console.log('subscription test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
