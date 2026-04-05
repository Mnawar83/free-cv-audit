const os = require('os');
const path = require('path');

function setupIsolatedRunStoreEnv(testName) {
  const safeName = String(testName || 'test')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  process.env.RUN_STORE_PATH = path.join(os.tmpdir(), `free-cv-audit-${safeName}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  process.env.RUN_STORE_DURABLE_URL = '';
  process.env.RUN_STORE_DURABLE_TOKEN = '';
}

module.exports = { setupIsolatedRunStoreEnv };
