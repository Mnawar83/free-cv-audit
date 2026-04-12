const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('send-cv-email-quality-floor.test');
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.URL = 'https://app.freecvaudit.com';
  process.env.CV_STRICT_STYLE_MODE = 'false';
  process.env.CV_QUALITY_FLOOR_MODE = 'true';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'run_quality_floor';
  await runStore.upsertRun(runId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_fallback_generated_at: new Date().toISOString(),
  });

  clearModule('../netlify/functions/send-cv-email');
  const { handler } = require('../netlify/functions/send-cv-email');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      runId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      resend: false,
    }),
  });

  assert.strictEqual(response.statusCode, 409);
  const payload = JSON.parse(response.body || '{}');
  assert.ok(String(payload.error || '').includes('still being refined for quality'));

  delete process.env.CV_QUALITY_FLOOR_MODE;
  delete process.env.CV_STRICT_STYLE_MODE;
  console.log('send-cv-email quality floor test passed');
}

run().catch((error) => {
  delete process.env.CV_QUALITY_FLOOR_MODE;
  delete process.env.CV_STRICT_STYLE_MODE;
  console.error(error);
  process.exitCode = 1;
});
