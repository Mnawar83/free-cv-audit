const assert = require('assert');
const fs = require('fs');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.RUN_STORE_PATH = '/tmp/free-cv-audit-generate-pdf-fallback-test.json';
  delete process.env.OPENAI_MODEL;
  delete process.env.CONTEXT;

  try {
    fs.unlinkSync(process.env.RUN_STORE_PATH);
  } catch (_) {
    // ignore cleanup errors
  }

  const fetchCalls = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body || '{}');
    fetchCalls.push(body.model);

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
        choices: [{ message: { content: 'Jane Doe\nEXPERIENCE\nBuilt systems.' } }],
      }),
    };
  };

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/open-ai');
  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: 'Original CV text' }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(fetchCalls[0], 'gpt-4.1-mini');
  assert.strictEqual(fetchCalls[1], 'gpt-4o-mini');

  console.log('Generate PDF model fallback test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
