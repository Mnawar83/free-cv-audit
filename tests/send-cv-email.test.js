const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.URL = 'https://app.freecvaudit.com';
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  const runId = 'run_for_email_attachment';
  await runStore.upsertRun(runId, {
    revised_cv_text: 'Jane Doe\nEXPERIENCE\n- Built stable systems',
  });

  let capturedPayload = null;
  global.fetch = async (_url, options = {}) => {
    capturedPayload = JSON.parse(options.body || '{}');
    return {
      ok: true,
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
  assert.ok(!capturedPayload.attachments, 'Email should not include PDF attachments.');
  const tokenMatch = capturedPayload.html.match(/cv-email-download\?token=([a-z0-9-]+)/i);
  assert.ok(tokenMatch, 'Email should contain a tokenized cv-email-download link.');
  const token = tokenMatch[1];
  assert.ok(
    capturedPayload.html.includes('https://app.freecvaudit.com/.netlify/functions/cv-email-download?token='),
    'Email should contain the hosted tokenized download link.',
  );

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
  assert.strictEqual(expiredResponse.statusCode, 404, 'Expired token should be pruned and treated as not found.');

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
  assert.strictEqual(missingRunResponse.statusCode, 404);
  assert.strictEqual(missingRunEmailSent, false, 'Email should not be sent when run data is missing.');

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

  console.log('send-cv-email canonical link test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
