const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('process-email-queue-scheduled.test');
  process.env.RESEND_API_KEY = 'schedule-test-key';
  process.env.CV_EMAIL_ASYNC_MODE = 'true';
  process.env.QUEUE_PROCESSOR_SECRET = 'scheduled-secret';
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'scheduled-run-id';
  const queuedPdfBase64 = Buffer.alloc(256, 's').toString('base64');
  const queuedArtifactToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: queuedArtifactToken,
    runId,
    pdf_base64: queuedPdfBase64,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await runStore.upsertRun(runId, { revised_cv_text: 'Scheduled Candidate\nEXPERIENCE\n- Cron processed' });

  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'email_sched_1' }) });

  clearModule('../netlify/functions/send-cv-email');
  const sendHandler = require('../netlify/functions/send-cv-email').handler;
  const queued = await sendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'cron@example.com',
      name: 'Cron',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      runId,
      pdfBase64: queuedPdfBase64,
      artifactToken: queuedArtifactToken,
    }),
  });
  assert.strictEqual(queued.statusCode, 202);

  clearModule('../netlify/functions/process-email-queue-scheduled');
  const scheduled = require('../netlify/functions/process-email-queue-scheduled');
  assert.ok(scheduled.config?.schedule, 'Scheduled wrapper should expose cron schedule config.');
  const processed = await scheduled.handler();
  assert.strictEqual(processed.statusCode, 200);
  const payload = JSON.parse(processed.body || '{}');
  assert.ok(payload.processed.length >= 1);
  assert.ok(payload.processed.some((item) => item.status === 'COMPLETED'));

  console.log('process-email-queue-scheduled test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
