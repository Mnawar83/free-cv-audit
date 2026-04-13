const assert = require('assert');
const fs = require('fs');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.CV_QUALITY_FLOOR_MODE = 'true';
  process.env.CV_STRICT_STYLE_MODE = 'false';
  process.env.RUN_STORE_PATH = '/tmp/free-cv-audit-quality-floor-get-test.json';
  delete process.env.GOOGLE_AI_API_KEY;

  try {
    fs.unlinkSync(process.env.RUN_STORE_PATH);
  } catch (_error) {
    // ignore cleanup
  }

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'quality_floor_get_run';
  await runStore.upsertRun(runId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built delivery systems',
    revised_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built delivery systems',
    revised_cv_fallback_generated_at: new Date().toISOString(),
  });

  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { runId },
  });

  assert.strictEqual(response.statusCode, 425);
  assert.ok(String(response.body || '').includes('quality-checked and refined'));

  delete process.env.CV_QUALITY_FLOOR_MODE;
  delete process.env.CV_STRICT_STYLE_MODE;
  console.log('Generate PDF quality floor GET test passed');
}

run().catch((error) => {
  delete process.env.CV_QUALITY_FLOOR_MODE;
  delete process.env.CV_STRICT_STYLE_MODE;
  console.error(error);
  process.exitCode = 1;
});
