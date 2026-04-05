const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('queue-health.test');
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  await runStore.enqueueEmailJob({ email: 'health@example.com' });
  await runStore.upsertEmailDownload('health-token', { revised_cv_text: 'Health CV' });
  await runStore.upsertEmailDelivery('delivery:health', { provider: 'resend', status: 'SENT' });

  clearModule('../netlify/functions/queue-health');
  const { handler } = require('../netlify/functions/queue-health');
  const response = await handler({ httpMethod: 'GET' });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body || '{}');
  assert.strictEqual(payload.ok, true);
  assert.ok(payload.stats.queue.total >= 1);
  assert.ok(payload.stats.downloads.total >= 1);
  assert.ok(payload.stats.deliveries.total >= 1);

  console.log('queue-health test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
