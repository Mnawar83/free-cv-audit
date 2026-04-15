const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('send-cv-email-quality-floor-rebind-runid.test');
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.URL = 'https://app.freecvaudit.com';
  process.env.CV_QUALITY_FLOOR_MODE = 'true';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const oldRunId = 'run_old_with_fallback';
  await runStore.upsertRun(oldRunId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_text: 'Old fallback text',
    revised_cv_fallback_generated_at: new Date().toISOString(),
  });
  let providerSendCount = 0;

  global.fetch = async (_url, options = {}) => ({
    ok: true,
    status: 200,
    json: async () => {
      providerSendCount += 1;
      return { id: 'email_123', payload: JSON.parse(options.body || '{}') };
    },
  });

  clearModule('../netlify/functions/send-cv-email');
  const { handler } = require('../netlify/functions/send-cv-email');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      runId: oldRunId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${oldRunId}`,
      resend: false,
    }),
  });

  assert.strictEqual(response.statusCode, 409, 'Quality floor should block email delivery when fallback CV is detected.');
  assert.strictEqual(providerSendCount, 0, 'Email provider should not be called when quality floor blocks send.');

  delete process.env.CV_QUALITY_FLOOR_MODE;
  console.log('send-cv-email quality floor runId rebind test passed');
}

run().catch((error) => {
  delete process.env.CV_QUALITY_FLOOR_MODE;
  console.error(error);
  process.exitCode = 1;
});
