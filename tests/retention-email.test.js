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
  setupIsolatedRunStoreEnv('retention-email.test');
  process.env.USER_SESSION_SECRET = 'test-user-session-secret';
  delete process.env.RESEND_API_KEY;

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/user-session');
  clearModule('../netlify/functions/retention-email');

  const runStore = require('../netlify/functions/run-store');
  const userSession = require('../netlify/functions/user-session');
  const retentionEmail = require('../netlify/functions/retention-email');

  const sessionResponse = await userSession.handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'retention-user@example.com' }),
  });
  assert.strictEqual(sessionResponse.statusCode, 200);
  const cookie = `__Host-cv_user_session=${extractCookieValue(sessionResponse.headers['Set-Cookie'])}`;
  const sessionPayload = JSON.parse(sessionResponse.body || '{}');
  const userId = sessionPayload?.user?.userId;
  assert.ok(userId);

  await runStore.upsertRun('run_retention_1', {
    status: 'completed',
    score: 81,
    full_audit_result: {
      summaryRecommendations: ['Tailor your summary to a product manager role.'],
      experienceRecommendations: ['Add quantified launch outcomes.'],
      skillsRecommendations: ['Prioritize stakeholder communication and roadmap planning.'],
    },
  });
  await runStore.linkRunToUser(userId, 'run_retention_1');

  const response = await retentionEmail.handler({
    httpMethod: 'POST',
    headers: { cookie },
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.ok, true);
  assert.ok(String(payload.message || '').toLowerCase().includes('weekly cv health recap'));
  assert.ok(payload.summary);
  assert.ok(Number.isFinite(Number(payload.summary.weeklyHealthScore)));
  assert.ok(Array.isArray(payload.summary.roleSuggestions));

  const noSession = await retentionEmail.handler({
    httpMethod: 'POST',
    headers: {},
  });
  assert.strictEqual(noSession.statusCode, 401);

  console.log('retention email test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
