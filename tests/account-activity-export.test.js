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
  setupIsolatedRunStoreEnv('account-activity-export.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/subscription');
  clearModule('../netlify/functions/account-activity-export');

  const runStore = require('../netlify/functions/run-store');
  const userSession = require('../netlify/functions/user-session');
  const subscription = require('../netlify/functions/subscription');
  const exportHandler = require('../netlify/functions/account-activity-export');

  const sessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'export-user@example.com' }),
  });
  assert.strictEqual(sessionResponse.statusCode, 200);
  const cookie = `__Host-cv_user_session=${extractCookieValue(sessionResponse.headers['Set-Cookie'])}`;
  const userId = JSON.parse(sessionResponse.body || '{}')?.user?.userId;

  await subscription.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      plan: 'pro',
      status: 'ACTIVE',
      provider: 'internal',
      lastSuccessfulPaymentAt: '2026-01-02T00:00:00.000Z',
      nextRenewalAt: '2026-02-02T00:00:00.000Z',
    }),
  });
  await runStore.upsertRun('run_export_1', { status: 'completed', score: 90 });
  await runStore.linkRunToUser(userId, 'run_export_1');

  const jsonResponse = await exportHandler.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: { format: 'json' },
  });
  assert.strictEqual(jsonResponse.statusCode, 200);
  const jsonPayload = JSON.parse(jsonResponse.body || '{}');
  assert.strictEqual(jsonPayload.ok, true);
  assert.strictEqual(jsonPayload.subscriptions.length, 1);
  assert.strictEqual(jsonPayload.runs.length, 1);
  assert.strictEqual(jsonPayload.subscriptions[0].nextRenewalAt, '2026-02-02T00:00:00.000Z');

  const csvResponse = await exportHandler.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: { format: 'csv' },
  });
  assert.strictEqual(csvResponse.statusCode, 200);
  assert.ok(String(csvResponse.headers['Content-Type'] || '').includes('text/csv'));
  assert.ok(String(csvResponse.body || '').includes('recordType'));
  assert.ok(String(csvResponse.body || '').includes('subscription'));
  assert.ok(String(csvResponse.body || '').includes('run_export_1'));

  const unauthorizedResponse = await exportHandler.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { format: 'json' },
  });
  assert.strictEqual(unauthorizedResponse.statusCode, 401);

  console.log('account activity export test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
