const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  const storePath = path.join('/tmp', `free-cv-audit-generate-test-${process.pid}-${Date.now()}.json`);
  process.env.RUN_STORE_PATH = storePath;

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const seededRunId = 'run_seeded_cached_pdf';
  await runStore.upsertRun(seededRunId, {
    original_cv_text: 'Alice Example\nExperience\n- Built systems',
    revised_cv_text: 'Alice Example\nEXPERIENCE\n- Built resilient systems',
  });
  const legacySeededRunId = 'run_legacy_cached_pdf_only';
  await runStore.upsertRun(legacySeededRunId, {
    revised_cv_text: 'Legacy Candidate\nEXPERIENCE\n- Existing revised CV only',
  });

  clearModule('../netlify/functions/generate-pdf');
  let handler = require('../netlify/functions/generate-pdf').handler;

  const cachedResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ runId: seededRunId }),
  });

  assert.strictEqual(cachedResponse.statusCode, 200);
  assert.strictEqual(cachedResponse.headers['Content-Type'], 'application/pdf');
  assert.strictEqual(cachedResponse.headers['x-run-id'], seededRunId);
  assert.ok(cachedResponse.body.length > 0);
  assert.strictEqual(cachedResponse.isBase64Encoded, true);

  const legacyCachedResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ runId: legacySeededRunId }),
  });

  assert.strictEqual(legacyCachedResponse.statusCode, 200);
  assert.strictEqual(legacyCachedResponse.headers['Content-Type'], 'application/pdf');
  assert.strictEqual(legacyCachedResponse.headers['x-run-id'], legacySeededRunId);
  assert.ok(legacyCachedResponse.body.length > 0);
  assert.strictEqual(legacyCachedResponse.isBase64Encoded, true);

  process.env.GOOGLE_AI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: false,
    json: async () => ({ error: { message: 'simulated AI outage' } }),
  });

  clearModule('../netlify/functions/generate-pdf');
  handler = require('../netlify/functions/generate-pdf').handler;

  const fallbackResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: 'Bob Example\nExperience\n- Shipped products' }),
  });

  assert.strictEqual(fallbackResponse.statusCode, 200);
  assert.strictEqual(fallbackResponse.headers['Content-Type'], 'application/pdf');
  assert.ok(fallbackResponse.headers['x-run-id']);
  assert.ok(fallbackResponse.body.length > 0);
  assert.strictEqual(fallbackResponse.isBase64Encoded, true);

  await fs.rm(storePath, { force: true });
  console.log('Generate PDF fallback test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
