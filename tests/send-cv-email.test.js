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
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const runId = 'run_for_email_attachment';
  await runStore.upsertRun(runId, {
    revised_cv_text: 'Jane Doe\nEXPERIENCE\n- Built stable systems',
  });

  let capturedPayload = null;
  let resendHeaders = null;
  global.fetch = async (_url, options = {}) => {
    capturedPayload = JSON.parse(options.body || '{}');
    resendHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_123' }),
    };
  };

  clearModule('../netlify/functions/send-cv-email');
  const { handler } = require('../netlify/functions/send-cv-email');

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      cvUrl: `/.netlify/functions/generate-pdf?runId=${runId}`,
      resend: false,
    }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.ok(capturedPayload, 'Resend payload should be sent.');
  assert.ok(Array.isArray(capturedPayload.attachments), 'Email should include a PDF backup attachment.');
  assert.strictEqual(capturedPayload.attachments[0].filename, 'revised-cv.pdf');
  assert.strictEqual(capturedPayload.attachments[0].content_type, 'application/pdf');
  const tokenMatch = capturedPayload.html.match(/cv-email-download\?token=([a-z0-9-]+)/i);
  assert.ok(tokenMatch, 'Email should contain a tokenized cv-email-download link.');
  const token = tokenMatch[1];
  assert.ok(
    capturedPayload.html.includes('https://app.freecvaudit.com/.netlify/functions/cv-email-download?token='),
    'Email should contain the hosted tokenized download link.',
  );
  assert.ok(
    capturedPayload.html.includes(`runId=${runId}`),
    'Email should include runId fallback in the tokenized download link.',
  );
  assert.ok(capturedPayload.html.includes('also attached as a PDF'), 'Email HTML should mention backup attachment.');
  assert.ok(Boolean(resendHeaders['Idempotency-Key']), 'Email send should include an idempotency key header.');
  const storedSnapshot = await runStore.getEmailDownload(token);
  assert.ok(storedSnapshot, 'Token snapshot should be stored.');
  assert.strictEqual(storedSnapshot.pdf_base64, capturedPayload.attachments[0].content, 'Stored snapshot should persist immutable PDF bytes.');

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
  assert.strictEqual(expiredResponse.statusCode, 302, 'Expired token should fall back to runId download URL when available.');
  assert.ok(
    String(expiredResponse.headers?.Location || '').includes(`runId=${runId}`),
    'Expired token fallback should redirect to runId-based generate-pdf URL.',
  );

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

  const missingSnapshotFallback = await downloadHandler({
    httpMethod: 'GET',
    queryStringParameters: { token: 'missing-token', runId },
  });
  assert.strictEqual(missingSnapshotFallback.statusCode, 302, 'Missing token snapshot should redirect to runId fallback URL.');
  assert.ok(
    String(missingSnapshotFallback.headers?.Location || '').includes(`runId=${runId}`),
    'Missing snapshot fallback should keep runId in generate-pdf redirect URL.',
  );

  let missingRunEmailSent = false;
  global.fetch = async () => {
    missingRunEmailSent = true;
    return {
      ok: true,
      json: async () => ({ id: 'email_should_not_send' }),
    };
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
  assert.strictEqual(missingRunResponse.statusCode, 200);
  assert.strictEqual(missingRunEmailSent, true, 'Email should still be sent when run text is missing.');

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

  console.log('send-cv-email canonical link test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
