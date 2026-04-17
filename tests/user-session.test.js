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
  setupIsolatedRunStoreEnv('user-session.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');

  const { handler } = require('../netlify/functions/user-session');

  const createResponse = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'person@example.com', name: 'Test Person' }),
  });

  assert.strictEqual(createResponse.statusCode, 200);
  const createPayload = JSON.parse(createResponse.body || '{}');
  assert.strictEqual(createPayload.ok, true);
  assert.ok(createPayload.user.userId.startsWith('usr_'));
  assert.strictEqual(createPayload.user.email, 'person@example.com');
  assert.strictEqual(createPayload.user.name, 'Test Person');

  const setCookie = createResponse.headers['Set-Cookie'];
  assert.ok(String(setCookie).includes('__Host-cv_user_session='));

  const getResponse = await handler({
    httpMethod: 'GET',
    headers: { cookie: `__Host-cv_user_session=${extractCookieValue(setCookie)}` },
  });
  assert.strictEqual(getResponse.statusCode, 200);
  const getPayload = JSON.parse(getResponse.body || '{}');
  assert.strictEqual(getPayload.ok, true);
  assert.strictEqual(getPayload.user.email, 'person@example.com');

  const badCreateResponse = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  assert.strictEqual(badCreateResponse.statusCode, 400);

  const deleteResponse = await handler({
    httpMethod: 'DELETE',
    headers: {},
    body: '',
  });
  assert.strictEqual(deleteResponse.statusCode, 200);

  console.log('user-session test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
