const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.RESEND_API_KEY = 'test-api-key';
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
  assert.ok(Array.isArray(capturedPayload.attachments), 'Email should include PDF attachments.');
  assert.strictEqual(capturedPayload.attachments[0].filename, 'revised-cv.pdf');
  assert.strictEqual(capturedPayload.attachments[0].content_type, 'application/pdf');
  assert.ok(capturedPayload.attachments[0].content.length > 100, 'PDF attachment should contain base64 data.');

  const providedBase64 = Buffer.from('%PDF-1.4\nfake-pdf\n%%EOF\n', 'utf8').toString('base64');
  let payloadFromProvidedAttachment = null;
  global.fetch = async (_url, options = {}) => {
    payloadFromProvidedAttachment = JSON.parse(options.body || '{}');
    return {
      ok: true,
      json: async () => ({ id: 'email_456' }),
    };
  };
  const directAttachmentResponse = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      email: 'user@example.com',
      name: 'Jane',
      cvUrl: '/.netlify/functions/generate-pdf?runId=missing_run',
      resend: true,
      attachmentBase64: providedBase64,
    }),
  });
  assert.strictEqual(directAttachmentResponse.statusCode, 200);
  assert.ok(Array.isArray(payloadFromProvidedAttachment.attachments), 'Provided attachment should be forwarded.');
  assert.strictEqual(payloadFromProvidedAttachment.attachments[0].content, providedBase64);

  console.log('send-cv-email runId fallback test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
