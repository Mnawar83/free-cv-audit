const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('teaser-fulfillment-gating.test');

  clearModule('../netlify/functions/init-run');
  clearModule('../netlify/functions/run-store');
  const initRun = require('../netlify/functions/init-run').handler;
  const runStore = require('../netlify/functions/run-store');

  const response = await initRun({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: 'This is a sample cv text with enough content to pass minimum validation for teaser only stage.' }),
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.ok(payload.runId);

  const run = await runStore.getRun(payload.runId);
  assert.strictEqual(run.teaser_audit_status, 'teaser_audit_ready');
  assert.strictEqual(run.fulfillment_status, 'payment_pending');
  assert.ok(!run.revised_cv_text, 'teaser stage must not generate final revised cv');

  console.log('teaser fulfillment gating test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
