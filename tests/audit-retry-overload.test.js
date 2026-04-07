const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  delete process.env.GOOGLE_AI_MODEL;
  delete process.env.RUN_STORE_DURABLE_URL;

  const statuses = [503, 503, 503, 503];
  let callCount = 0;
  global.fetch = async () => {
    const status = statuses[Math.min(callCount, statuses.length - 1)];
    callCount += 1;
    return {
      ok: false,
      status,
      text: async () => JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }),
    };
  };

  clearModule('../netlify/functions/run-store');
  clearModule('../netlify/functions/google-ai');
  clearModule('../netlify/functions/audit');
  const handler = require('../netlify/functions/audit').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ cvText: 'Senior engineer with measurable outcomes and ATS-ready formatting.' }),
  });

  assert.strictEqual(response.statusCode, 500);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.code, 'AUDIT_TEMP_UNAVAILABLE');
  assert.strictEqual(payload.error, 'Our audit service is experiencing high traffic. Please try again in a moment.');
  assert.ok(callCount >= 2);

  console.log('Audit overload retry handling test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
