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
  setupIsolatedRunStoreEnv('subscription-checkout.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';
  process.env.SUBSCRIPTION_CHECKOUT_URL_TEMPLATE = 'https://pay.example.com/checkout?plan={PLAN}&uid={USER_ID}&return={RETURN_URL}';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/subscription-checkout');

  const userSession = require('../netlify/functions/user-session');
  const checkout = require('../netlify/functions/subscription-checkout');

  const sessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'checkout-user@example.com' }),
  });
  assert.strictEqual(sessionResponse.statusCode, 200);
  const cookie = `__Host-cv_user_session=${extractCookieValue(sessionResponse.headers['Set-Cookie'])}`;

  const checkoutResponse = await checkout.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: { plan: 'team', returnUrl: 'https://app.example.com/account' },
  });
  assert.strictEqual(checkoutResponse.statusCode, 200);
  const payload = JSON.parse(checkoutResponse.body || '{}');
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.plan, 'team');
  assert.ok(payload.checkoutUrl.includes('plan=team'));
  assert.ok(payload.checkoutUrl.includes('return=https%3A%2F%2Fapp.example.com%2Faccount'));

  const badPlanResponse = await checkout.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: { plan: 'free' },
  });
  assert.strictEqual(badPlanResponse.statusCode, 400);

  const noSessionResponse = await checkout.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { plan: 'pro' },
  });
  assert.strictEqual(noSessionResponse.statusCode, 401);

  console.log('subscription checkout test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
