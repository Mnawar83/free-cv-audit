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
  setupIsolatedRunStoreEnv('subscription-billing-portal.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';
  process.env.BILLING_PORTAL_URL_TEMPLATE = 'https://billing.example.com/u/{USER_ID}?return={RETURN_URL}';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/subscription');
  clearModule('../netlify/functions/subscription-billing-portal');

  const userSession = require('../netlify/functions/user-session');
  const subscription = require('../netlify/functions/subscription');
  const billingPortal = require('../netlify/functions/subscription-billing-portal');

  const sessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'billing-user@example.com' }),
  });
  assert.strictEqual(sessionResponse.statusCode, 200);
  const cookie = `__Host-cv_user_session=${extractCookieValue(sessionResponse.headers['Set-Cookie'])}`;

  const proResponse = await subscription.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ plan: 'pro', status: 'ACTIVE', provider: 'internal' }),
  });
  assert.strictEqual(proResponse.statusCode, 200);

  const portalResponse = await billingPortal.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: { returnUrl: 'https://app.example.com/account' },
  });
  assert.strictEqual(portalResponse.statusCode, 200);
  const portalPayload = JSON.parse(portalResponse.body || '{}');
  assert.strictEqual(portalPayload.ok, true);
  assert.strictEqual(portalPayload.plan, 'pro');
  assert.ok(portalPayload.billingPortalUrl.startsWith('https://billing.example.com/u/usr_'));
  assert.ok(portalPayload.billingPortalUrl.includes('return=https%3A%2F%2Fapp.example.com%2Faccount'));

  const noSessionResponse = await billingPortal.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {},
  });
  assert.strictEqual(noSessionResponse.statusCode, 401);

  console.log('subscription billing portal test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
