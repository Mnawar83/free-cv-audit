const assert = require('assert');
const fs = require('fs');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  process.env.RUN_STORE_PATH = '/tmp/free-cv-audit-generate-pdf-fallback-test.json';
  delete process.env.GOOGLE_AI_MODEL;
  delete process.env.CONTEXT;
  delete process.env.RUN_STORE_DURABLE_URL;

  try {
    fs.unlinkSync(process.env.RUN_STORE_PATH);
  } catch (_) {
    // ignore cleanup errors
  }

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(url);

    if (fetchCalls.length === 1) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'Model not found for this API version.' } }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Jane Doe\nEXPERIENCE\nBuilt systems.' }] } }],
      }),
    };
  };

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/google-ai');
  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: 'Original CV text' }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.ok(fetchCalls[0].includes('/models/gemini-3.1-pro-preview:generateContent'));
  assert.ok(fetchCalls[1].includes('/models/gemini-3.1-flash:generateContent'));

  console.log('Generate PDF model fallback test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
