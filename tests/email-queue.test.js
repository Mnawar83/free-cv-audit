const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('email-queue.test');
  process.env.RESEND_API_KEY = 'queue-test-key';
  process.env.CV_EMAIL_ASYNC_MODE = 'true';
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'queued-run-id';
  await runStore.upsertRun(runId, { revised_cv_text: 'Queued Candidate\nEXPERIENCE\n- Async tested' });

  let sendCount = 0;
  global.fetch = async () => {
    sendCount += 1;
    return { ok: true, status: 200, json: async () => ({ id: `email_${sendCount}` }) };
  };

  clearModule('../netlify/functions/send-cv-email');
  const sendHandler = require('../netlify/functions/send-cv-email').handler;
  const queuedResponse = await sendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'queue@example.com',
      name: 'Queue',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      runId,
    }),
  });
  assert.strictEqual(queuedResponse.statusCode, 202);

  clearModule('../netlify/functions/process-email-queue');
  const processHandler = require('../netlify/functions/process-email-queue').handler;
  const processResponse = await processHandler({ httpMethod: 'POST' });
  assert.strictEqual(processResponse.statusCode, 200);
  const payload = JSON.parse(processResponse.body || '{}');
  assert.ok(Array.isArray(payload.processed) && payload.processed.length === 1);
  assert.strictEqual(payload.processed[0].status, 'COMPLETED');
  assert.strictEqual(sendCount, 1);

  const queuedFailure = await sendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'queue-fail@example.com',
      name: 'Queue Fail',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      runId,
    }),
  });
  assert.strictEqual(queuedFailure.statusCode, 202);

  process.env.CV_EMAIL_QUEUE_MAX_ATTEMPTS = '1';
  global.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'downstream error' }) });
  const failedProcess = await processHandler({ httpMethod: 'POST' });
  const failedPayload = JSON.parse(failedProcess.body || '{}');
  assert.strictEqual(failedPayload.processed[0].status, 'DEAD_LETTER');

  process.env.CV_EMAIL_QUEUE_MAX_ATTEMPTS = '3';
  const queuedPermanentFailure = await sendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'queue-missing@example.com',
      name: 'Queue Missing',
      cvUrl: '/.netlify/functions/generate-pdf?runId=missing_run',
      runId: 'missing_run',
    }),
  });
  assert.strictEqual(queuedPermanentFailure.statusCode, 202);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'email_missing_run_ok' }) });

  const permanentFailureProcess = await processHandler({ httpMethod: 'POST' });
  const permanentFailurePayload = JSON.parse(permanentFailureProcess.body || '{}');
  assert.strictEqual(
    permanentFailurePayload.processed[0].status,
    'COMPLETED',
    'Missing run text should still send the recovery email with runId URL.',
  );

  console.log('email-queue test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
