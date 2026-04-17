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
  setupIsolatedRunStoreEnv('workspace.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session-auth');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/subscription');
  clearModule('../netlify/functions/workspace');

  const userSession = require('../netlify/functions/user-session');
  const subscription = require('../netlify/functions/subscription');
  const workspace = require('../netlify/functions/workspace');

  const sessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'workspace-owner@example.com' }),
  });
  assert.strictEqual(sessionResponse.statusCode, 200);
  const cookie = `__Host-cv_user_session=${extractCookieValue(sessionResponse.headers['Set-Cookie'])}`;

  const blockedResponse = await workspace.handler({
    httpMethod: 'GET',
    headers: { cookie },
  });
  assert.strictEqual(blockedResponse.statusCode, 402);

  const teamResponse = await subscription.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ plan: 'team', status: 'ACTIVE', provider: 'internal' }),
  });
  assert.strictEqual(teamResponse.statusCode, 200);

  const inviteResponse = await workspace.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'teammate@example.com' }),
  });
  assert.strictEqual(inviteResponse.statusCode, 200);
  const invitePayload = JSON.parse(inviteResponse.body || '{}');
  assert.strictEqual(invitePayload.ok, true);
  assert.strictEqual(invitePayload.members.length, 1);

  const listResponse = await workspace.handler({
    httpMethod: 'GET',
    headers: { cookie },
  });
  assert.strictEqual(listResponse.statusCode, 200);
  const listPayload = JSON.parse(listResponse.body || '{}');
  assert.strictEqual(listPayload.members.length, 1);
  assert.strictEqual(listPayload.members[0].email, 'teammate@example.com');

  const updateResponse = await workspace.handler({
    httpMethod: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'teammate@example.com', role: 'admin', status: 'ACTIVE' }),
  });
  assert.strictEqual(updateResponse.statusCode, 200);
  const updatePayload = JSON.parse(updateResponse.body || '{}');
  assert.strictEqual(updatePayload.ok, true);
  assert.strictEqual(updatePayload.members[0].role, 'admin');
  assert.strictEqual(updatePayload.members[0].status, 'ACTIVE');

  const removeResponse = await workspace.handler({
    httpMethod: 'DELETE',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'teammate@example.com' }),
  });
  assert.strictEqual(removeResponse.statusCode, 200);
  const removePayload = JSON.parse(removeResponse.body || '{}');
  assert.strictEqual(removePayload.ok, true);
  assert.strictEqual(removePayload.members.length, 0);

  console.log('workspace test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
