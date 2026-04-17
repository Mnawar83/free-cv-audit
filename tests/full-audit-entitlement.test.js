const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('full-audit-entitlement.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const user = await runStore.upsertUserByEmail('entitlement@example.com', {});
  await runStore.refreshUserEntitlements(user.user_id);

  const runId = 'run_full_audit_entitlement_1';
  await runStore.upsertRun(runId, {
    original_cv_text: 'Experienced product manager with strong cross-functional leadership and roadmap delivery skills.',
    user_id: user.user_id,
    fulfillment_status: 'payment_pending',
  });
  await runStore.linkRunToUser(user.user_id, runId);

  clearModule('../netlify/functions/user-session-auth');
  const { createUserSessionCookie } = require('../netlify/functions/user-session-auth');
  const cookie = createUserSessionCookie({
    userId: user.user_id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const cookieValue = String(cookie).split(';')[0].split('=')[1];

  clearModule('../netlify/functions/full-audit');
  const { handler } = require('../netlify/functions/full-audit');

  const response = await handler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `__Host-cv_user_session=${cookieValue}`,
    },
    body: JSON.stringify({ runId }),
  });

  assert.strictEqual(response.statusCode, 402);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.code, 'FULL_AUDIT_NOT_ENTITLED');

  console.log('full-audit entitlement test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
