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

  await runStore.upsertRun('structured_fallback_run', {
    revised_cv_structured: {
      fullName: 'Alex Rivera',
      sections: [{ heading: 'Experience', bullets: 'invalid-should-be-array' }],
    },
    revised_cv_text: 'Alex Rivera\nExperience\n- Delivered critical systems\n- Improved reliability',
  });
  global.fetch = async (url) => {
    if (String(url).includes('api.resend.com/emails')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_123' }),
      };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  };
  const fallbackResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'candidate@example.com',
      cvUrl: 'https://freecvaudit.com/.netlify/functions/generate-pdf?runId=structured_fallback_run',
      runId: 'structured_fallback_run',
      forceSync: true,
    }),
  });
  assert.strictEqual(fallbackResponse.statusCode, 200, 'Should fall back to revised text PDF when structured render fails.');

  console.log('send cv email attachment required test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
