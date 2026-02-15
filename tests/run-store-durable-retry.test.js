const assert = require('assert');
const http = require('http');

async function run() {
  const originalEnv = { ...process.env };
  const requests = [];
  let getCount = 0;
  let stored = null;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, body, headers: req.headers });

      if (req.method === 'GET') {
        getCount += 1;
        if (getCount < 3) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'temporary outage' }));
          return;
        }

        if (!stored) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"etag-1"' });
        res.end(JSON.stringify(stored));
        return;
      }

      if (req.method === 'PUT') {
        stored = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"etag-2"' });
        res.end(JSON.stringify(stored));
        return;
      }

      res.writeHead(405);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    process.env.CONTEXT = 'production';
    process.env.RUN_STORE_DURABLE_URL = `http://127.0.0.1:${port}`;
    delete process.env.RUN_STORE_DURABLE_TOKEN;

    delete require.cache[require.resolve('../netlify/functions/run-store.js')];
    const { upsertRun } = require('../netlify/functions/run-store.js');

    const run = await upsertRun('retry-test-run', { foo: 'bar' });
    assert.strictEqual(run.runId, 'retry-test-run');
    assert.ok(getCount >= 3);

    const getRequests = requests.filter((r) => r.method === 'GET');
    const putRequests = requests.filter((r) => r.method === 'PUT');
    assert.strictEqual(getRequests.length, 3);
    assert.strictEqual(putRequests.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
    delete require.cache[require.resolve('../netlify/functions/run-store.js')];
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
