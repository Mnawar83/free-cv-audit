const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

const savedGoogleAiKey = process.env.GOOGLE_AI_API_KEY;

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('send-cv-email-quality-floor.test');
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.URL = 'https://app.freecvaudit.com';
  process.env.CV_STRICT_STYLE_MODE = 'false';
  process.env.CV_QUALITY_FLOOR_MODE = 'true';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const runId = 'run_quality_floor';
  await runStore.upsertRun(runId, {
    original_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_text: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Built stable systems',
    revised_cv_fallback_generated_at: new Date().toISOString(),
    final_cv_pdf_base64: Buffer.alloc(256, 'q').toString('base64'),
    final_cv_artifact_token: runStore.createEmailDownloadToken(),
  });
  await runStore.createArtifactToken({
    token: (await runStore.getRun(runId)).final_cv_artifact_token,
    runId,
    pdf_base64: (await runStore.getRun(runId)).final_cv_pdf_base64,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  clearModule('../netlify/functions/send-cv-email');
  clearModule('../netlify/functions/generate-pdf');
  clearModule('../netlify/functions/google-ai');
  const { handler } = require('../netlify/functions/send-cv-email');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      runId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      resend: false,
    }),
  });

  assert.strictEqual(response.statusCode, 409);
  const payload = JSON.parse(response.body || '{}');
  assert.ok(String(payload.error || '').includes('still being refined for quality'));

  let providerSendCount = 0;
  const fulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'user@example.com',
    provider: 'paypal',
    provider_order_id: `order_quality_floor_${Date.now()}`,
    payment_status: 'PAID',
  });
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      providerSendCount += 1;
      return { id: 'email_force_sync_quality_floor_bypass' };
    },
  });
  const forceSyncResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      runId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      resend: true,
      forceSync: true,
      fulfillmentId: fulfillment.fulfillment_id,
    }),
  });
  assert.strictEqual(forceSyncResponse.statusCode, 200, 'Fulfillment forceSync sends should bypass quality-floor gating once artifact is ready.');
  assert.strictEqual(providerSendCount, 1, 'Force-sync fulfillment send should invoke provider.');

  delete process.env.CV_QUALITY_FLOOR_MODE;
  delete process.env.CV_STRICT_STYLE_MODE;
  if (savedGoogleAiKey) process.env.GOOGLE_AI_API_KEY = savedGoogleAiKey;
  console.log('send-cv-email quality floor test passed');
}

run().catch((error) => {
  delete process.env.CV_QUALITY_FLOOR_MODE;
  delete process.env.CV_STRICT_STYLE_MODE;
  if (savedGoogleAiKey) process.env.GOOGLE_AI_API_KEY = savedGoogleAiKey;
  console.error(error);
  process.exitCode = 1;
});
