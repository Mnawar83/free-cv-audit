const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  process.env.FULL_AUDIT_MODEL_TIMEOUT_MS = '1000';

  clearModule('../netlify/functions/full-audit');
  const { runFullAudit } = require('../netlify/functions/full-audit');

  let capturedBody = null;
  global.fetch = async (_url, options = {}) => {
    capturedBody = JSON.parse(options.body || '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '```json\n{"auditFindings":["A"],"improvementNotes":["B"],"atsKeywordSuggestions":["C"],"summaryRecommendations":["D"],"experienceRecommendations":["E"],"skillsRecommendations":["F"]}\n```',
                },
              ],
            },
          },
        ],
      }),
    };
  };

  const audit = await runFullAudit('json_mode_run', 'Sample CV text', '');
  assert.strictEqual(audit.auditFindings[0], 'A');
  assert.strictEqual(audit.skillsRecommendations[0], 'F');
  assert.strictEqual(capturedBody?.generationConfig?.responseMimeType, 'application/json');

  console.log('full audit json mode test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
