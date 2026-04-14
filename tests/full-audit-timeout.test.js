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

  global.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    signal?.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    }, { once: true });
  });

  const started = Date.now();
  const audit = await Promise.race([
    runFullAudit('timeout_run', 'Sample CV text for timeout test.', ''),
    new Promise((_, reject) => setTimeout(() => reject(new Error('runFullAudit timeout test exceeded expected duration')), 7000)),
  ]);

  const elapsed = Date.now() - started;
  assert.ok(elapsed < 7000, 'runFullAudit should return promptly after model timeouts.');
  assert.ok(Array.isArray(audit.auditFindings), 'Fallback audit structure should be returned.');
  assert.ok(audit.auditFindings.length > 0, 'Fallback audit should include findings.');

  console.log('full audit timeout test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
