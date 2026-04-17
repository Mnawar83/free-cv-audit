const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('init-run-free-limit.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';
  process.env.FREE_TIER_AUDIT_LIMIT = '2';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const user = await runStore.upsertUserByEmail('limited@example.com', { name: 'Limited User' });

  // No paid subscription -> no unlimited entitlements.
  await runStore.refreshUserEntitlements(user.user_id);

  // Seed two existing runs.
  await runStore.upsertRun('run_seed_1', { original_cv_text: 'seed 1', user_id: user.user_id });
  await runStore.linkRunToUser(user.user_id, 'run_seed_1');
  await runStore.upsertRun('run_seed_2', { original_cv_text: 'seed 2', user_id: user.user_id });
  await runStore.linkRunToUser(user.user_id, 'run_seed_2');

  clearModule('../netlify/functions/user-session-auth');
  const { createUserSessionCookie } = require('../netlify/functions/user-session-auth');
  const cookie = createUserSessionCookie({
    userId: user.user_id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const cookieValue = String(cookie).split(';')[0].split('=')[1];

  clearModule('../netlify/functions/init-run');
  const { handler } = require('../netlify/functions/init-run');
  const response = await handler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `__Host-cv_user_session=${cookieValue}`,
    },
    body: JSON.stringify({ cvText: 'This is a valid CV text sample with more than fifty characters for test execution.' }),
  });

  assert.strictEqual(response.statusCode, 402);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.code, 'FREE_AUDIT_LIMIT_REACHED');

  console.log('init-run free limit test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
