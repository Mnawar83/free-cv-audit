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
  setupIsolatedRunStoreEnv('user-session-code.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';
  process.env.USER_SESSION_RETURN_DEBUG_CODE = 'true';
  process.env.USER_SESSION_CODE_SEND = 'false';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-request-code');
  clearModule('../netlify/functions/user-session-verify-code');
  clearModule('../netlify/functions/user-session');

  const requestCodeHandler = require('../netlify/functions/user-session-request-code').handler;
  const verifyCodeHandler = require('../netlify/functions/user-session-verify-code').handler;
  const userSessionHandler = require('../netlify/functions/user-session').handler;

  const requestResponse = await requestCodeHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({ email: 'verify@example.com' }),
  });
  assert.strictEqual(requestResponse.statusCode, 200);
  const requestPayload = JSON.parse(requestResponse.body || '{}');
  assert.strictEqual(requestPayload.ok, true);
  assert.ok(requestPayload.debugCode);

  const verifyResponse = await verifyCodeHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'verify@example.com', code: requestPayload.debugCode }),
  });
  assert.strictEqual(verifyResponse.statusCode, 200);
  const verifyPayload = JSON.parse(verifyResponse.body || '{}');
  assert.strictEqual(verifyPayload.ok, true);
  const setCookie = verifyResponse.headers['Set-Cookie'];
  assert.ok(setCookie);

  const getSessionResponse = await userSessionHandler({
    httpMethod: 'GET',
    headers: { cookie: `__Host-cv_user_session=${extractCookieValue(setCookie)}` },
  });
  assert.strictEqual(getSessionResponse.statusCode, 200);

  const badVerifyResponse = await verifyCodeHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'verify@example.com', code: '000000' }),
  });
  assert.strictEqual(badVerifyResponse.statusCode, 401);

  console.log('user-session code flow test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
