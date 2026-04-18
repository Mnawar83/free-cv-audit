const assert = require('assert');
const { execFileSync } = require('child_process');

let failed = false;
try {
  execFileSync('node', ['-e', "process.env.CONTEXT='production'; delete process.env.RUN_STORE_DURABLE_URL; delete process.env.RUN_STORE_DURABLE_TOKEN; require('./netlify/functions/run-store');"], { stdio: 'pipe' });
} catch (error) {
  failed = true;
  const stderr = String(error.stderr || '');
  const stdout = String(error.stdout || '');
  assert.ok((stderr + stdout).includes('Durable run store is required in production'));
}
assert.strictEqual(failed, true);
console.log('run-store-env-enforcement.test.js passed');
