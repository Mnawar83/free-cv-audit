const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function run() {
  delete process.env.GOOGLE_AI_MODEL;
  clearModule('../netlify/functions/google-ai');
  let googleAi = require('../netlify/functions/google-ai');

  assert.strictEqual(googleAi.DEFAULT_GOOGLE_AI_MODEL, 'gemini-3.1-pro-preview');
  assert.strictEqual(googleAi.GOOGLE_AI_MODEL, 'gemini-3.1-pro-preview');

  process.env.GOOGLE_AI_MODEL = 'gemini-2.5-pro';
  clearModule('../netlify/functions/google-ai');
  googleAi = require('../netlify/functions/google-ai');

  assert.strictEqual(googleAi.GOOGLE_AI_MODEL, 'gemini-2.5-pro');
  const url = googleAi.buildGoogleAiUrl('test-key');
  assert.ok(url.includes('/models/gemini-2.5-pro:generateContent?key=test-key'));

  delete process.env.GOOGLE_AI_MODEL;
  console.log('Google AI model env override test passed');
}

run();
