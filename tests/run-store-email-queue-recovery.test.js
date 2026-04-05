const assert = require('assert');
const fs = require('fs/promises');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('run-store-email-queue-recovery.test');
  process.env.CV_EMAIL_QUEUE_PROCESSING_LEASE_MS = '60000';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const queued = await runStore.enqueueEmailJob({ email: 'recover@example.com' });
  const claimed = await runStore.claimEmailJob();
  assert.ok(claimed, 'Expected initial claim to return a job.');
  assert.strictEqual(claimed.id, queued.id);
  assert.strictEqual(claimed.status, 'PROCESSING');
  assert.strictEqual(claimed.attempts, 1);

  const raw = await fs.readFile(process.env.RUN_STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  parsed.emailQueue[0].status = 'PROCESSING';
  parsed.emailQueue[0].updated_at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await fs.writeFile(process.env.RUN_STORE_PATH, JSON.stringify(parsed, null, 2), 'utf8');

  const recovered = await runStore.claimEmailJob();
  assert.ok(recovered, 'Expected stale PROCESSING job to be requeued and claimed.');
  assert.strictEqual(recovered.id, queued.id);
  assert.strictEqual(recovered.status, 'PROCESSING');
  assert.strictEqual(recovered.attempts, 2, 'Recovered claim should increment attempts.');

  await runStore.completeEmailJob(recovered.id, { status: 'COMPLETED' });
  const none = await runStore.claimEmailJob();
  assert.strictEqual(none, null);

  console.log('run-store-email-queue-recovery test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
