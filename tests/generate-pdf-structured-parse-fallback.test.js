const assert = require('assert');
const fs = require('fs');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  process.env.CV_STRICT_STYLE_MODE = 'false';
  process.env.RUN_STORE_PATH = '/tmp/free-cv-audit-structured-parse-fallback-test.json';
  delete process.env.GOOGLE_AI_MODEL;
  delete process.env.CONTEXT;
  delete process.env.RUN_STORE_DURABLE_URL;

  try {
    fs.unlinkSync(process.env.RUN_STORE_PATH);
  } catch (_error) {
    // ignore cleanup errors
  }

  const originalCvText = `Jane Doe
PROFESSIONAL SUMMARY
Original summary that should survive fallback.
PROFESSIONAL EXPERIENCE
Engineer | Acme | Remote | 2021 - Present
- Built stable services`;

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
  const runStore = require('../netlify/functions/run-store');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: originalCvText }),
  });

  assert.strictEqual(response.statusCode, 200);
  const runId = response.headers['x-run-id'];
  assert.ok(runId, 'Expected x-run-id header');

  const run = await runStore.getRun(runId);
  assert.ok(run, 'Expected run to be stored');
  assert.ok(run.revised_cv_fallback_generated_at, 'Expected parse failure to trigger fallback marker');
  assert.ok(run.revised_cv_text.includes('Original summary that should survive fallback.'));
  assert.ok(!run.revised_cv_text.includes('"fullName"'));

  console.log('Generate PDF structured parse fallback test passed');
}

run().catch((error) => {
  delete process.env.CV_STRICT_STYLE_MODE;
  console.error(error);
  process.exitCode = 1;
});
