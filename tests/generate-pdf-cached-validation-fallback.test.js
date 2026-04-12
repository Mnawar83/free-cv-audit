const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  const storePath = path.join('/tmp', `free-cv-audit-generate-cached-validation-${process.pid}-${Date.now()}.json`);
  process.env.RUN_STORE_PATH = storePath;
  delete process.env.RUN_STORE_DURABLE_URL;
  delete process.env.GOOGLE_AI_API_KEY;

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const runId = 'run_cached_validation_fallback';
  await runStore.upsertRun(runId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built compliant systems',
    revised_cv_text: 'BROKENCACHED\nPROFESSIONAL EXPERIENCE\n- Built compliant systems',
  });

  const pdfBuilderPath = require.resolve('../netlify/functions/pdf-builder');
  delete require.cache[pdfBuilderPath];
  const realPdfBuilder = require('../netlify/functions/pdf-builder');
  require.cache[pdfBuilderPath].exports = {
    ...realPdfBuilder,
    normalizeToCvTemplateText: (text) => {
      if (String(text).includes('BROKENCACHED')) {
        throw new Error('CV export validation failed: simulated canonicalization validation failure.');
      }
      return realPdfBuilder.normalizeToCvTemplateText(text);
    },
    buildPdfBuffer: (text) => {
      if (String(text).includes('BROKENCACHED')) {
        throw new Error('CV export validation failed: simulated cached validation failure.');
      }
      return realPdfBuilder.buildPdfBuffer(text);
    },
  };

  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ runId }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['Content-Type'], 'application/pdf');
  assert.strictEqual(response.headers['x-run-id'], runId);
  assert.ok(response.body.length > 0);

  const updatedRun = await runStore.getRun(runId);
  assert.ok(updatedRun.revised_cv_fallback_generated_at, 'Fallback timestamp should be set after cached validation fallback.');

  await fs.rm(storePath, { force: true });
  console.log('Generate PDF cached validation fallback test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
