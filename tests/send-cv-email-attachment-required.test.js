const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('send-cv-email-attachment-required.test');
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.CV_QUALITY_FLOOR_MODE = 'off';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  await runStore.upsertRun('attachment_required_run', {
    teaser_audit_status: 'teaser_audit_ready',
  });

  global.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => Buffer.from(''),
    json: async () => ({ message: 'downstream unavailable' }),
  });

  clearModule('../netlify/functions/send-cv-email');
  const handler = require('../netlify/functions/send-cv-email').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'candidate@example.com',
      cvUrl: 'https://freecvaudit.com/.netlify/functions/generate-pdf?runId=attachment_required_run',
      runId: 'attachment_required_run',
      forceSync: true,
    }),
  });

  assert.strictEqual(response.statusCode, 409);
  const payload = JSON.parse(response.body || '{}');
  assert.ok(String(payload.error || '').includes('attachment is not ready'));

  console.log('send cv email attachment required test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
