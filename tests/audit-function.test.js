const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.OPENAI_API_KEY = 'test-key';

  let capturedPayload;
  global.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Overall ATS Match: 82%\n\nStrengths:\n- Strong impact bullets' } }],
      }),
    };
  };

  clearModule('../netlify/functions/audit');
  const handler = require('../netlify/functions/audit').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: 'Senior software engineer with 8 years of experience...' }),
  });

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.ok(payload.auditResult.includes('Overall ATS Match'));

  const promptText = capturedPayload.messages[0].content;
  assert.ok(promptText.includes('Return a complete audit immediately'));
  assert.ok(promptText.includes('Never say you are ready to begin'));
  assert.ok(promptText.includes('Do not include a rewritten professional summary section'));
  assert.ok(!promptText.includes('Rewritten Professional Summary'));
  assert.ok(capturedPayload.messages[1].content.startsWith('Audit this CV now:'));

  console.log('Audit function test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
