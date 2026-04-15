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
  const queuedPdfBase64 = Buffer.alloc(256, 'q').toString('base64');
  const queuedArtifactToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: queuedArtifactToken,
    runId,
    pdf_base64: queuedPdfBase64,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await runStore.upsertRun(runId, { revised_cv_text: 'Queued Candidate\nEXPERIENCE\n- Async tested' });

  let sendCount = 0;
  let triggerCount = 0;
  global.fetch = async (url) => {
    if (String(url).includes('process-email-queue')) {
      triggerCount += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
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
      pdfBase64: queuedPdfBase64,
      artifactToken: queuedArtifactToken,
    }),
  });
  assert.strictEqual(queuedResponse.statusCode, 202);

  clearModule('../netlify/functions/process-email-queue');
  const processHandler = require('../netlify/functions/process-email-queue').handler;

  process.env.QUEUE_PROCESSOR_SECRET = 'queue-secret';
  const forbiddenResponse = await processHandler({ httpMethod: 'POST', headers: {} });
  assert.strictEqual(forbiddenResponse.statusCode, 403);
  const authorizedResponse = await processHandler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer queue-secret' },
  });
  assert.strictEqual(authorizedResponse.statusCode, 200);
  const authorizedPayload = JSON.parse(authorizedResponse.body || '{}');
  assert.ok(Array.isArray(authorizedPayload.processed) && authorizedPayload.processed.length === 1);
  assert.strictEqual(authorizedPayload.processed[0].status, 'COMPLETED');
  assert.strictEqual(sendCount, 1);
  const processResponse = await processHandler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer queue-secret' },
  });
  assert.strictEqual(processResponse.statusCode, 200);
  const payload = JSON.parse(processResponse.body || '{}');
  assert.ok(Array.isArray(payload.processed));
  assert.strictEqual(payload.processed.length, 0);
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
  const failedProcess = await processHandler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const failedPayload = JSON.parse(failedProcess.body || '{}');
  assert.strictEqual(failedPayload.processed[0].status, 'DEAD_LETTER');

  process.env.CV_EMAIL_QUEUE_MAX_ATTEMPTS = '3';
  process.env.CV_EMAIL_ASYNC_MODE = 'false';
  clearModule('../netlify/functions/send-cv-email');
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'email_missing_run_ok' }) });

  const missingRunSendHandler = require('../netlify/functions/send-cv-email').handler;
  const missingRunResponse = await missingRunSendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'queue-missing@example.com',
      name: 'Queue Missing',
      cvUrl: '/.netlify/functions/generate-pdf?runId=missing_run',
      runId: 'missing_run',
      forceSync: true,
    }),
  });
  assert.strictEqual(
    missingRunResponse.statusCode,
    425,
    'Missing run should return retryable artifact-not-ready when no prepared artifact is available.',
  );

  delete process.env.QUEUE_PROCESSOR_SECRET;

  console.log('email-queue test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
