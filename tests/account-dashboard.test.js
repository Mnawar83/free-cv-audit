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
  setupIsolatedRunStoreEnv('account-dashboard.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/subscription');
  clearModule('../netlify/functions/workspace');
  clearModule('../netlify/functions/account-dashboard');

  const runStore = require('../netlify/functions/run-store');
  const userSession = require('../netlify/functions/user-session');
  const subscription = require('../netlify/functions/subscription');
  const workspace = require('../netlify/functions/workspace');
  const dashboard = require('../netlify/functions/account-dashboard');

  const sessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'dashboard-user@example.com' }),
  });
  assert.strictEqual(sessionResponse.statusCode, 200);
  const cookie = `__Host-cv_user_session=${extractCookieValue(sessionResponse.headers['Set-Cookie'])}`;
  const sessionPayload = JSON.parse(sessionResponse.body || '{}');
  const userId = sessionPayload?.user?.userId;
  assert.ok(userId);

  const subResponse = await subscription.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ plan: 'team', status: 'ACTIVE', provider: 'internal' }),
  });
  assert.strictEqual(subResponse.statusCode, 200);
  const canceledSubResponse = await subscription.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      plan: 'pro',
      status: 'CANCELED',
      provider: 'internal',
      lastSuccessfulPaymentAt: '2026-01-01T00:00:00.000Z',
      nextRenewalAt: '2026-02-01T00:00:00.000Z',
    }),
  });
  assert.strictEqual(canceledSubResponse.statusCode, 200);

  const inviteResponse = await workspace.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'member@example.com', role: 'member', status: 'INVITED' }),
  });
  assert.strictEqual(inviteResponse.statusCode, 200);

  await runStore.upsertRun('run_dashboard_1', { status: 'completed', score: 84 });
  await runStore.upsertRun('run_dashboard_2', { status: 'failed', score: 41 });
  await runStore.linkRunToUser(userId, 'run_dashboard_1');
  await runStore.linkRunToUser(userId, 'run_dashboard_2');

  const dashboardResponse = await dashboard.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: {},
  });
  assert.strictEqual(dashboardResponse.statusCode, 200);
  const payload = JSON.parse(dashboardResponse.body || '{}');
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.user.userId, userId);
  assert.strictEqual(payload.entitlements.plan, 'team');
  assert.strictEqual(payload.workspace.memberCount, 1);
  assert.strictEqual(payload.subscriptions.length, 2);
  assert.strictEqual(payload.recentRuns.length, 2);
  assert.strictEqual(payload.recentRuns[0].runId, 'run_dashboard_2');
  assert.ok(payload.pagination);

  const pagedResponse = await dashboard.handler({
    httpMethod: 'GET',
    headers: { cookie },
    queryStringParameters: { subLimit: '1', subOffset: '0', runLimit: '1', runOffset: '0', runStatus: 'FAILED', subStatus: 'CANCELED' },
  });
  assert.strictEqual(pagedResponse.statusCode, 200);
  const pagedPayload = JSON.parse(pagedResponse.body || '{}');
  assert.strictEqual(pagedPayload.subscriptions.length, 1);
  assert.strictEqual(pagedPayload.subscriptions[0].status, 'CANCELED');
  assert.strictEqual(pagedPayload.subscriptions[0].lastSuccessfulPaymentAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(pagedPayload.subscriptions[0].nextRenewalAt, '2026-02-01T00:00:00.000Z');
  assert.strictEqual(pagedPayload.recentRuns.length, 1);
  assert.strictEqual(pagedPayload.recentRuns[0].runId, 'run_dashboard_2');

  const unauthorizedResponse = await dashboard.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {},
  });
  assert.strictEqual(unauthorizedResponse.statusCode, 401);

  console.log('account dashboard test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
