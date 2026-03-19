const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'free-cv-linkedin-test-'));
  const storePath = path.join(tempDir, 'run-store.json');

  process.env.CONTEXT = 'deploy-preview';
  process.env.RUN_STORE_PATH = storePath;
  delete process.env.RUN_STORE_DURABLE_URL;
  process.env.WHISHPAY_CHANNEL = 'test-channel';
  process.env.WHISHPAY_SECRET = 'test-secret';
  process.env.WHISHPAY_WEBSITE_URL = 'https://example.test';
  process.env.WHISHPAY_BASE_URL = 'https://api.whish.test';
  process.env.GOOGLE_AI_API_KEY = 'test-key';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/whishpay-utils');
  clearModule('../netlify/functions/linkedin-upsell-init');
  clearModule('../netlify/functions/whishpay-linkedin-create-payment');
  clearModule('../netlify/functions/linkedin-generate-docx');

  const { createRunId, upsertRun, getRun } = require('../netlify/functions/run-store');
  const linkedinInit = require('../netlify/functions/linkedin-upsell-init').handler;
  const whishCreate = require('../netlify/functions/whishpay-linkedin-create-payment').handler;
  const linkedinGenerate = require('../netlify/functions/linkedin-generate-docx').handler;

  const runId = createRunId();
  await upsertRun(runId, { linkedin_upsell_status: 'NOT_STARTED' });

  const initResponse = await linkedinInit({
    httpMethod: 'POST',
    body: JSON.stringify({ runId, providedLinkedInUrl: 'https://www.linkedin.com/in/test-user' }),
  });

  assert.strictEqual(initResponse.statusCode, 200, 'linkedin-upsell-init should succeed');
  const initPayload = JSON.parse(initResponse.body);
  assert.strictEqual(initPayload.status, 'PENDING_PAYMENT', 'run should transition to PENDING_PAYMENT');

  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ status: true, collectUrl: 'https://checkout.whish.test/collect' }),
  });

  const createResponse = await whishCreate({
    httpMethod: 'POST',
    body: JSON.stringify({ runId, successRedirectUrl: 'https://app.test/success', failureRedirectUrl: 'https://app.test/fail' }),
  });

  assert.strictEqual(createResponse.statusCode, 200, 'whishpay-linkedin-create-payment should succeed');
  const createPayload = JSON.parse(createResponse.body);
  assert.ok(createPayload.externalId, 'externalId should be returned');
  assert.strictEqual(createPayload.collectUrl, 'https://checkout.whish.test/collect');

  const updatedRun = await getRun(runId);
  assert.strictEqual(updatedRun.linkedin_upsell_status, 'PENDING_PAYMENT');
  assert.strictEqual(updatedRun.linkedin_whish_external_id, String(createPayload.externalId));

  await upsertRun(runId, {
    linkedin_upsell_status: 'PAID',
    revised_cv_text: 'Senior engineer with leadership and platform modernization achievements.',
  });

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Headline: Platform Leader\u0000\nAbout: Delivered measurable outcomes.\u0001' }] } }],
    }),
  });

  const generateResponse = await linkedinGenerate({
    httpMethod: 'POST',
    body: JSON.stringify({ runId }),
  });
  assert.strictEqual(generateResponse.statusCode, 200, 'linkedin-generate-docx should succeed');

  const generatedRun = await getRun(runId);
  assert.strictEqual(generatedRun.linkedin_upsell_status, 'GENERATED');
  assert.ok(generatedRun.linkedin_docx_base64, 'docx should be stored');

  const docxBuffer = Buffer.from(generatedRun.linkedin_docx_base64, 'base64');
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.ok(!documentXml.includes('\u0000'), 'invalid NUL character should be removed from generated XML');
  assert.ok(!documentXml.includes('\u0001'), 'invalid control character should be removed from generated XML');

  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('LinkedIn upsell flow test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
