const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function loadOpenAi() {
  clearModule('../netlify/functions/open-ai');
  return require('../netlify/functions/open-ai');
}

function run() {
  delete process.env.OPENAI_MODEL;
  let openAi = loadOpenAi();
  assert.strictEqual(openAi.getOpenAiModel(), 'gpt-4.1-mini');
  assert.strictEqual(openAi.buildOpenAiUrl('test-key'), 'https://api.openai.com/v1/chat/completions');
  assert.deepStrictEqual(openAi.getOpenAiCandidateModels(), ['gpt-4.1-mini', 'gpt-4o-mini']);

  process.env.OPENAI_MODEL = 'gpt-4.1';
  openAi = loadOpenAi();
  assert.strictEqual(openAi.getOpenAiModel(), 'gpt-4.1');
  assert.deepStrictEqual(openAi.getOpenAiCandidateModels(), ['gpt-4.1', 'gpt-4o-mini']);

  const text = openAi.extractOpenAiText({ choices: [{ message: { content: 'hello world' } }] });
  assert.strictEqual(text, 'hello world');

  console.log('OpenAI helper test passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
