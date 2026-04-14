const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('send-cv-email.test');
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.URL = 'https://app.freecvaudit.com';
  process.env.CV_STRICT_STYLE_MODE = 'false';
  process.env.CV_QUALITY_FLOOR_MODE = 'false';
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const runId = 'run_for_email_attachment';
  const preparedPdfBase64 = Buffer.alloc(512, 'a').toString('base64');
  const preparedToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: preparedToken,
    runId,
    pdf_base64: preparedPdfBase64,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await runStore.upsertRun(runId, {
    revised_cv_text: 'Jane Doe\nEXPERIENCE\n- Built stable systems',
    final_cv_pdf_base64: preparedPdfBase64,
    final_cv_artifact_token: preparedToken,
    final_cv_artifact_ready_at: new Date().toISOString(),
  });
  const paidFulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'user@example.com',
    provider: 'paypal',
    provider_order_id: 'order_123',
    payment_status: 'PAID',
  });

  let capturedPayload = null;
  let resendHeaders = null;
  global.fetch = async (_url, options = {}) => {
    if (String(_url).includes('/.netlify/functions/generate-pdf')) {
      throw new Error('send-cv-email should not fetch generate-pdf during delivery');
    }
    capturedPayload = JSON.parse(options.body || '{}');
    resendHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_123' }),
    };
  };

  clearModule('../netlify/functions/send-cv-email');
  let generatePdfCallCount = 0;
  const generatePdfPath = require.resolve('../netlify/functions/generate-pdf');
  delete require.cache[generatePdfPath];
  require.cache[generatePdfPath] = {
    id: generatePdfPath,
    filename: generatePdfPath,
    loaded: true,
    exports: {
      handler: async () => {
        generatePdfCallCount += 1;
        return { statusCode: 500, body: JSON.stringify({ error: 'should not be called' }) };
      },
    },
  };
  const { handler } = require('../netlify/functions/send-cv-email');

  const backgroundWork = [];
  const response = await handler({
    httpMethod: 'POST',
    waitUntil: (p) => backgroundWork.push(p),
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      fulfillmentId: paidFulfillment.fulfillment_id,
      resend: false,
    }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(generatePdfCallCount, 0, 'send-cv-email should not call generate-pdf.');
  assert.ok(capturedPayload, 'Resend payload should be sent.');
  assert.ok(Array.isArray(capturedPayload.attachments) && capturedPayload.attachments.length === 1, 'Email should include a PDF attachment fallback.');
  const tokenMatch = capturedPayload.html.match(/cv-email-download\?token=([a-z0-9-]+)/i);
  assert.ok(tokenMatch, 'Email should contain a tokenized cv-email-download link.');
  const token = tokenMatch[1];
  assert.ok(
    capturedPayload.html.includes('https://app.freecvaudit.com/.netlify/functions/cv-email-download?token='),
    'Email should contain the hosted tokenized download link.',
  );
  assert.ok(Boolean(resendHeaders['Idempotency-Key']), 'Email send should include an idempotency key header.');
  await Promise.allSettled(backgroundWork);
  const storedSnapshot = await runStore.getArtifactToken(token);
  assert.ok(storedSnapshot, 'Token snapshot should be stored.');
  assert.ok(storedSnapshot.pdf_base64, 'Prepared artifact token should persist immutable PDF bytes.');
  const updatedFulfillment = await runStore.getFulfillment(paidFulfillment.fulfillment_id);
  assert.strictEqual(updatedFulfillment.email_status, 'SENT', 'Paid fulfillment email status should be updated after send.');

  process.env.CV_DOWNLOAD_RATE_LIMIT_MAX = '3';
  process.env.CV_DOWNLOAD_RATE_LIMIT_WINDOW_MS = '60000';
  clearModule('../netlify/functions/cv-email-download');
  const downloadHandler = require('../netlify/functions/cv-email-download').handler;
  const downloadResponse = await downloadHandler({
    httpMethod: 'GET',
    queryStringParameters: { token },
  });
  assert.strictEqual(downloadResponse.statusCode, 200);
  assert.strictEqual(downloadResponse.headers['Content-Type'], 'application/pdf');
  assert.ok(downloadResponse.body.length > 100);
  assert.strictEqual(downloadResponse.isBase64Encoded, true);

  let rateLimitedResponse = null;
  for (let index = 0; index < 4; index += 1) {
    rateLimitedResponse = await downloadHandler({
      httpMethod: 'GET',
      queryStringParameters: { token },
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
  }
  assert.strictEqual(rateLimitedResponse.statusCode, 429, 'Repeated token requests should be rate limited.');

  const expiredToken = runStore.createEmailDownloadToken();
  await runStore.upsertEmailDownload(expiredToken, {
    runId,
    revised_cv_text: 'Expired snapshot',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const expiredResponse = await downloadHandler({
    httpMethod: 'GET',
    queryStringParameters: { token: expiredToken },
  });
  assert.strictEqual(expiredResponse.statusCode, 410, 'Expired token should return a clear expiration response.');

  const invalidPdfToken = runStore.createEmailDownloadToken();
  await runStore.upsertEmailDownload(invalidPdfToken, {
    runId,
    pdf_base64: 'not-base64-@@@',
    revised_cv_text: 'Fallback Candidate\nEXPERIENCE\n- Works as expected',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const invalidPdfResponse = await downloadHandler({
    httpMethod: 'GET',
    queryStringParameters: { token: invalidPdfToken },
  });
  assert.strictEqual(invalidPdfResponse.statusCode, 200, 'Invalid stored base64 should fall back to regenerated PDF.');
  assert.strictEqual(invalidPdfResponse.headers['Content-Type'], 'application/pdf');
  assert.ok(invalidPdfResponse.body.length > 100);

  const maxDownloadToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: maxDownloadToken,
    runId,
    pdf_base64: storedSnapshot.pdf_base64,
    max_downloads: 1,
    download_count: 1,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const maxDownloadResponse = await downloadHandler({
    httpMethod: 'GET',
    queryStringParameters: { token: maxDownloadToken },
  });
  assert.strictEqual(maxDownloadResponse.statusCode, 410, 'Token should expire when max download count is reached.');

  const missingSnapshotFallback = await downloadHandler({
    httpMethod: 'GET',
    queryStringParameters: { token: 'missing-token', runId },
  });
  assert.strictEqual(missingSnapshotFallback.statusCode, 404, 'Missing token snapshot should return not found.');

  let missingRunEmailSent = false;
  global.fetch = async (_url, options = {}) => {
    missingRunEmailSent = true;
    return { ok: true, json: async () => ({ id: 'email_should_not_send' }) };
  };
  const missingRunResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      cvUrl: '/.netlify/functions/generate-pdf?runId=missing_run',
      resend: true,
    }),
  });
  assert.strictEqual(missingRunResponse.statusCode, 425);
  assert.strictEqual(missingRunEmailSent, false, 'Email should not send when prepared final artifact is missing.');

  const missingRunIdResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      cvUrl: '/.netlify/functions/generate-pdf',
      resend: true,
    }),
  });
  assert.strictEqual(missingRunIdResponse.statusCode, 400);

  const pendingFulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'pending@example.com',
    provider: 'paypal',
    provider_order_id: 'order_pending',
    payment_status: 'PENDING',
  });
  const pendingFulfillmentResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'pending@example.com',
      name: 'Pending',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      runId,
      fulfillmentId: pendingFulfillment.fulfillment_id,
      resend: false,
    }),
  });
  assert.strictEqual(pendingFulfillmentResponse.statusCode, 409, 'Pending fulfillment should not be emailed.');

  let retryAttempt = 0;
  global.fetch = async () => {
    retryAttempt += 1;
    if (retryAttempt < 2) {
      return { ok: false, status: 502, json: async () => ({ error: 'temporary outage' }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'email_retry_ok' }) };
  };
  const retryResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'retry@example.com',
      name: 'Retry',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      runId,
      resend: false,
    }),
  });
  assert.strictEqual(retryResponse.statusCode, 200, 'Retryable provider errors should be retried and eventually succeed.');
  assert.strictEqual(retryAttempt, 2, 'Handler should retry after transient provider failure.');

  delete process.env.CV_STRICT_STYLE_MODE;
  delete process.env.CV_QUALITY_FLOOR_MODE;
  console.log('send-cv-email canonical link test passed');
}

run().catch((error) => {
  delete process.env.CV_STRICT_STYLE_MODE;
  delete process.env.CV_QUALITY_FLOOR_MODE;
  console.error(error);
  process.exitCode = 1;
});
