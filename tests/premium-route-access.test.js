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

async function createSessionCookie(email) {
  const { handler } = require('../netlify/functions/user-session');
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const setCookie = response.headers['Set-Cookie'];
  return `__Host-cv_user_session=${extractCookieValue(setCookie)}`;
}

async function run() {
  setupIsolatedRunStoreEnv('premium-route-access.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const owner = await runStore.upsertUserByEmail('owner@example.com', {});

  const runId = 'run_premium_access_1';
  await runStore.upsertRun(runId, {
    user_id: owner.user_id,
    linkedin_pdf_text: 'LinkedIn Optimization\n\nSample content',
  });
  await runStore.linkRunToUser(owner.user_id, runId);

  clearModule('../netlify/functions/user-session');
  const ownerCookie = await createSessionCookie('owner@example.com');
  const otherCookie = await createSessionCookie('other@example.com');

  clearModule('../netlify/functions/linkedin-download-pdf');
  const handler = require('../netlify/functions/linkedin-download-pdf').handler;

  const noSession = await handler({
    httpMethod: 'GET',
    queryStringParameters: { runId },
    headers: {},
  });
  assert.strictEqual(noSession.statusCode, 401);

  const wrongUser = await handler({
    httpMethod: 'GET',
    queryStringParameters: { runId },
    headers: { cookie: otherCookie },
  });
  assert.strictEqual(wrongUser.statusCode, 403);

  const ownerAccess = await handler({
    httpMethod: 'GET',
    queryStringParameters: { runId },
    headers: { cookie: ownerCookie },
  });
  assert.strictEqual(ownerAccess.statusCode, 200);

  console.log('premium route access test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
