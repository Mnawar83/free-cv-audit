const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'free-cv-cover-letter-test-'));
  const storePath = path.join(tempDir, 'run-store.json');

  process.env.CONTEXT = 'deploy-preview';
  process.env.RUN_STORE_PATH = storePath;
  process.env.GOOGLE_AI_API_KEY = 'test-key';

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/cover-letter-init');
  clearModule('../netlify/functions/cover-letter-generate-docx');

  const { createRunId, upsertRun, getRun } = require('../netlify/functions/run-store');
  const coverLetterInit = require('../netlify/functions/cover-letter-init').handler;
  const coverLetterGenerate = require('../netlify/functions/cover-letter-generate-docx').handler;

  const runId = createRunId();
  await upsertRun(runId, {
    cover_letter_status: 'NOT_STARTED',
    revised_cv_text: 'Experienced software engineer with strong API and frontend skills.',
  });

  const initResponse = await coverLetterInit({
    httpMethod: 'POST',
    body: JSON.stringify({ runId, jobLink: 'https://jobs.example.test/role' }),
  });
  assert.strictEqual(initResponse.statusCode, 200);
  assert.strictEqual(JSON.parse(initResponse.body).status, 'PENDING_PAYMENT');

  await upsertRun(runId, { cover_letter_status: 'PAID', job_page_text: 'short', job_page_text_length: 5 });

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Dear Hiring Manager\n\nI am excited to apply for this opportunity.\n\nThank you for your consideration.' }] } }],
    }),
  });

  const generateResponse = await coverLetterGenerate({
    httpMethod: 'POST',
    body: JSON.stringify({ runId }),
  });

  assert.strictEqual(generateResponse.statusCode, 200);
  const payload = JSON.parse(generateResponse.body);
  assert.strictEqual(payload.usedJobText, false);
  assert.ok(payload.downloadUrl);

  const updatedRun = await getRun(runId);
  assert.strictEqual(updatedRun.cover_letter_status, 'GENERATED');
  assert.strictEqual(updatedRun.used_job_text, false);
  assert.ok(updatedRun.cover_letter_docx_base64);

  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('Cover letter flow test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
