const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'durable-store-test-'));
  const storePath = path.join(tmpDir, 'store.json');
  const port = 8899;
  const token = 'test-token';

  const proc = spawn('node', ['scripts/durable-run-store-server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DURABLE_RUN_STORE_PATH: storePath,
      RUN_STORE_DURABLE_TOKEN: token,
    },
    stdio: 'ignore',
  });

  try {
    await wait(300);

    let response = await fetch(`http://127.0.0.1:${port}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(response.status, 404);

    response = await fetch(`http://127.0.0.1:${port}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'If-None-Match': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ runs: { first: { runId: 'first' } } }),
    });
    assert.strictEqual(response.status, 200);
    const firstEtag = response.headers.get('etag');
    assert.ok(firstEtag);

    response = await fetch(`http://127.0.0.1:${port}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'If-None-Match': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ runs: {} }),
    });
    assert.strictEqual(response.status, 412);

    response = await fetch(`http://127.0.0.1:${port}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'If-Match': firstEtag,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ runs: { second: { runId: 'second' } } }),
    });
    assert.strictEqual(response.status, 200);

    response = await fetch(`http://127.0.0.1:${port}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'If-Match': firstEtag,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ runs: { stale: true } }),
    });
    assert.strictEqual(response.status, 412);
  } finally {
    proc.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
