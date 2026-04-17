const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('track-event.test');

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/track-event');

  const runStore = require('../netlify/functions/run-store');
  const { handler } = require('../netlify/functions/track-event');

  const okResponse = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({
      eventName: 'audit_started',
      sessionId: 'sess_test',
      runId: 'run_123',
      context: { fileKind: 'pdf' },
    }),
  });

  assert.strictEqual(okResponse.statusCode, 202);
  const events = await runStore.listAnalyticsEvents(10);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].eventName, 'audit_started');
  assert.strictEqual(events[0].session_id, 'sess_test');
  assert.strictEqual(events[0].run_id, 'run_123');
  assert.strictEqual(events[0].context.fileKind, 'pdf');

  const invalidEventResponse = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2' },
    body: JSON.stringify({ eventName: 'unknown_event' }),
  });
  assert.strictEqual(invalidEventResponse.statusCode, 400);

  const missingNameResponse = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '3.3.3.3' },
    body: JSON.stringify({}),
  });
  assert.strictEqual(missingNameResponse.statusCode, 400);

  console.log('track-event test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
