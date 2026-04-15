const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.QUEUE_TRIGGER_DIRECT_FALLBACK = 'false';

  // Invalid max-attempts config should fall back to default attempts and still execute fetch.
  process.env.QUEUE_TRIGGER_MAX_ATTEMPTS = 'not-a-number';
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return { ok: true, status: 200 };
  };

  clearModule('../netlify/functions/queue-trigger');
  let queueTrigger = require('../netlify/functions/queue-trigger');
  let result = await queueTrigger.triggerFulfillmentQueueProcessing();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(fetchCount, 1, 'Queue trigger should attempt fetch even when max attempts env is invalid.');

  // Invalid max-attempts should still use retry default (2) for transient responses.
  process.env.QUEUE_TRIGGER_MAX_ATTEMPTS = 'NaN';
  fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) return { ok: false, status: 503 };
    return { ok: true, status: 200 };
  };

  clearModule('../netlify/functions/queue-trigger');
  queueTrigger = require('../netlify/functions/queue-trigger');
  result = await queueTrigger.triggerFulfillmentQueueProcessing();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(fetchCount, 2, 'Queue trigger should retry transient errors using fallback max attempts.');

  delete process.env.QUEUE_TRIGGER_MAX_ATTEMPTS;
  delete process.env.QUEUE_TRIGGER_DIRECT_FALLBACK;
  console.log('queue trigger test passed');
}

run().catch((error) => {
  delete process.env.QUEUE_TRIGGER_MAX_ATTEMPTS;
  delete process.env.QUEUE_TRIGGER_DIRECT_FALLBACK;
  console.error(error);
  process.exitCode = 1;
});
