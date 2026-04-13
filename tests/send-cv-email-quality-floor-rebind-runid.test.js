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
  const refreshedRunId = 'run_refreshed_clean';
  await runStore.upsertRun(oldRunId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_text: 'Old fallback text',
    revised_cv_fallback_generated_at: new Date().toISOString(),
  });
  await runStore.upsertRun(refreshedRunId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_fallback_generated_at: null,
    revised_cv_lenient_fallback_generated_at: null,
  });

  const generatePdfPath = require.resolve('../netlify/functions/generate-pdf');
  delete require.cache[generatePdfPath];
  require.cache[generatePdfPath] = {
    id: generatePdfPath,
    filename: generatePdfPath,
    loaded: true,
    exports: {
      handler: async () => ({
        statusCode: 200,
        headers: { 'x-run-id': refreshedRunId },
        body: '',
      }),
    },
  };

  global.fetch = async (_url, options = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'email_123', payload: JSON.parse(options.body || '{}') }),
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

  assert.strictEqual(response.statusCode, 200, 'Expected send to continue after rebinding to refreshed runId.');

  delete process.env.CV_QUALITY_FLOOR_MODE;
  console.log('send-cv-email quality floor runId rebind test passed');
}

run().catch((error) => {
  delete process.env.CV_QUALITY_FLOOR_MODE;
  console.error(error);
  process.exitCode = 1;
});
