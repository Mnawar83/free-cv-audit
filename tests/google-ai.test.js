const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function loadGoogleAi() {
  clearModule('../netlify/functions/google-ai');
  return require('../netlify/functions/google-ai');
}

function run() {
  delete process.env.GOOGLE_AI_MODEL;
  let googleAi = loadGoogleAi();
  assert.strictEqual(googleAi.getGoogleAiModel(), 'gemini-3.1-pro-preview');
  assert.ok(googleAi.buildGoogleAiUrl('test-key').includes('/models/gemini-3.1-pro-preview:generateContent'));
  assert.deepStrictEqual(googleAi.getGoogleAiCandidateModels(), ['gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']);
  assert.ok(
    googleAi
      .buildGoogleAiUrl('test-key', 'gemini-2.5-flash')
      .includes('/models/gemini-2.5-flash:generateContent'),
  );

  process.env.GOOGLE_AI_MODEL = 'gemini-2.5-pro';
  googleAi = loadGoogleAi();
  assert.strictEqual(googleAi.getGoogleAiModel(), 'gemini-2.5-pro');
  assert.ok(googleAi.buildGoogleAiUrl('test-key').includes('/models/gemini-2.5-pro:generateContent'));
  assert.deepStrictEqual(googleAi.getGoogleAiCandidateModels(), ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']);

  console.log('Google AI helper test passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
