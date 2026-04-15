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

  // Expired artifact token should be refreshed before composing resend link
  const expiredFinalToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: expiredFinalToken,
    runId,
    pdf_base64: preparedPdfBase64,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await runStore.upsertRun(runId, {
    final_cv_artifact_token: expiredFinalToken,
  });
  let refreshedPayload = null;
  global.fetch = async (_url, options = {}) => {
    refreshedPayload = JSON.parse(options.body || '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_refresh_token' }),
    };
  };
  const refreshedTokenResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      runId,
      resend: true,
    }),
  });
  assert.strictEqual(refreshedTokenResponse.statusCode, 200, 'Resend should mint a fresh artifact token when stored token expired.');
  const refreshedTokenMatch = String(refreshedPayload?.html || '').match(/cv-email-download\?token=([a-z0-9-]+)/i);
  assert.ok(refreshedTokenMatch, 'Resend should still include tokenized link.');
  assert.notStrictEqual(refreshedTokenMatch[1], expiredFinalToken, 'Resend should not reuse an expired artifact token.');
  const refreshedRun = await runStore.getRun(runId);
  assert.strictEqual(refreshedRun.final_cv_artifact_token, refreshedTokenMatch[1], 'Run should track refreshed final artifact token.');

  // Token-only artifact should still send even when run.final_cv_pdf_base64 is absent
  const tokenOnlyRunId = 'token_only_artifact_run';
  const tokenOnlyPdfBase64 = Buffer.alloc(256, 't').toString('base64');
  const tokenOnlyArtifactToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: tokenOnlyArtifactToken,
    runId: tokenOnlyRunId,
    pdf_base64: tokenOnlyPdfBase64,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await runStore.upsertRun(tokenOnlyRunId, {
    revised_cv_text: 'Token-only run revised text',
    final_cv_pdf_base64: null,
    final_cv_artifact_token: tokenOnlyArtifactToken,
    final_cv_artifact_ready_at: new Date().toISOString(),
  });
  let tokenOnlyPayload = null;
  global.fetch = async (_url, options = {}) => {
    tokenOnlyPayload = JSON.parse(options.body || '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_token_only' }),
    };
  };
  const tokenOnlyResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'token-only@example.com',
      name: 'Token Only',
      runId: tokenOnlyRunId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${tokenOnlyRunId}`,
      resend: true,
    }),
  });
  assert.strictEqual(tokenOnlyResponse.statusCode, 200, 'Token-backed artifact should send without run-level pdf snapshot.');
  assert.ok(Array.isArray(tokenOnlyPayload?.attachments) && tokenOnlyPayload.attachments.length === 1, 'Token-backed artifact should still attach PDF.');

  // Expired token-only artifact should refresh from stored token pdf bytes (not return 425)
  const tokenOnlyExpiredRunId = 'token_only_expired_artifact_run';
  const tokenOnlyExpiredPdfBase64 = Buffer.alloc(256, 'x').toString('base64');
  const expiredTokenOnlyArtifactToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: expiredTokenOnlyArtifactToken,
    runId: tokenOnlyExpiredRunId,
    pdf_base64: tokenOnlyExpiredPdfBase64,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await runStore.upsertRun(tokenOnlyExpiredRunId, {
    revised_cv_text: 'Token-only expired run revised text',
    final_cv_pdf_base64: null,
    final_cv_artifact_token: expiredTokenOnlyArtifactToken,
    final_cv_artifact_ready_at: new Date().toISOString(),
  });
  let tokenOnlyExpiredPayload = null;
  global.fetch = async (_url, options = {}) => {
    tokenOnlyExpiredPayload = JSON.parse(options.body || '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_token_only_expired_refresh' }),
    };
  };
  const tokenOnlyExpiredResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'token-expired@example.com',
      name: 'Token Expired',
      runId: tokenOnlyExpiredRunId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${tokenOnlyExpiredRunId}`,
      resend: true,
    }),
  });
  assert.strictEqual(tokenOnlyExpiredResponse.statusCode, 200, 'Expired token-only artifact should refresh and send from stored token pdf bytes.');
  const tokenOnlyExpiredMatch = String(tokenOnlyExpiredPayload?.html || '').match(/cv-email-download\?token=([a-z0-9-]+)/i);
  assert.ok(tokenOnlyExpiredMatch, 'Expired token-only resend should include tokenized link.');
  assert.notStrictEqual(tokenOnlyExpiredMatch[1], expiredTokenOnlyArtifactToken, 'Expired token-only resend should mint a fresh token.');
  assert.ok(Array.isArray(tokenOnlyExpiredPayload?.attachments) && tokenOnlyExpiredPayload.attachments.length === 1, 'Expired token-only resend should still attach PDF.');
  const refreshedTokenOnlyRun = await runStore.getRun(tokenOnlyExpiredRunId);
  assert.strictEqual(refreshedTokenOnlyRun.final_cv_artifact_token, tokenOnlyExpiredMatch[1], 'Run should store refreshed token for token-only expired resend.');
  assert.strictEqual(refreshedTokenOnlyRun.final_cv_pdf_base64, tokenOnlyExpiredPdfBase64, 'Run should persist refreshed token pdf snapshot for future sends.');

  // Requests using pre-rotation runId should rebind to rotated run artifacts
  const rotatedOriginalRunId = 'rotated_original_run';
  const rotatedEffectiveRunId = 'rotated_effective_run';
  const rotatedPdfBase64 = Buffer.alloc(256, 'r').toString('base64');
  const rotatedArtifactToken = runStore.createEmailDownloadToken();
  await runStore.createArtifactToken({
    token: rotatedArtifactToken,
    runId: rotatedEffectiveRunId,
    pdf_base64: rotatedPdfBase64,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await runStore.upsertRun(rotatedOriginalRunId, {
    fulfillment_rotated_run_id: rotatedEffectiveRunId,
    revised_cv_text: 'Original run that should rebind to rotated artifacts',
  });
  await runStore.upsertRun(rotatedEffectiveRunId, {
    revised_cv_text: 'Rotated run revised CV',
    final_cv_pdf_base64: rotatedPdfBase64,
    final_cv_artifact_token: rotatedArtifactToken,
    final_cv_artifact_ready_at: new Date().toISOString(),
  });
  let rotatedPayload = null;
  global.fetch = async (_url, options = {}) => {
    rotatedPayload = JSON.parse(options.body || '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_rotated_rebind' }),
    };
  };
  const rotatedResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'rotated@example.com',
      name: 'Rotated',
      runId: rotatedOriginalRunId,
      cvUrl: `/.netlify/functions/generate-pdf?runId=${rotatedOriginalRunId}`,
      resend: true,
    }),
  });
  assert.strictEqual(rotatedResponse.statusCode, 200, 'Original runId resend should rebind to rotated run artifacts.');
  assert.ok(Array.isArray(rotatedPayload?.attachments) && rotatedPayload.attachments.length === 1, 'Rebound rotated run should include attachment.');

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
