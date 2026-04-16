const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('init-run-user-link.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const user = await runStore.upsertUserByEmail('runner@example.com', { name: 'Runner' });

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
    body: JSON.stringify({ cvText: 'Experienced software engineer with strong backend and frontend delivery skills over many years.' }),
  });

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.ok(payload.runId);

  const runs = await runStore.listUserRuns(user.user_id, 10);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].user_id, user.user_id);
  assert.strictEqual(String(runs[0].run_id || payload.runId).length > 0, true);

  console.log('init-run user link test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
