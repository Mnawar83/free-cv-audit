const assert = require('assert');
const fs = require('fs');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  process.env.CV_STRICT_STYLE_MODE = 'true';
  process.env.RUN_STORE_PATH = '/tmp/free-cv-audit-strict-structured-required-test.json';

  try {
    fs.unlinkSync(process.env.RUN_STORE_PATH);
  } catch (_error) {
    // ignore cleanup
  }

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '{"fullName":"Jane Doe","experience":[{"jobTitle":"Engineer",}]}' }] } }],
    }),
  });

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/google-ai');
  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cvText: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Led delivery',
    }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['Content-Type'], 'application/pdf');
  assert.ok(response.body.length > 0, 'Expected fallback PDF payload even when structured parse fails.');

  delete process.env.CV_STRICT_STYLE_MODE;
  delete process.env.GOOGLE_AI_API_KEY;
  console.log('Generate PDF strict structured-required test passed');
}

run().catch((error) => {
  delete process.env.CV_STRICT_STYLE_MODE;
  delete process.env.GOOGLE_AI_API_KEY;
  console.error(error);
  process.exitCode = 1;
});
