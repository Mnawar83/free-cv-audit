#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const STORE_PATH = process.env.DURABLE_RUN_STORE_PATH || path.join(process.cwd(), 'data', 'run-store.json');
const AUTH_TOKEN = process.env.RUN_STORE_DURABLE_TOKEN || '';

function json(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function etagForBody(rawBody) {
  return `"${crypto.createHash('sha256').update(rawBody).digest('hex')}"`;
}

async function readState() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const body = raw.trim() ? raw : '{"runs":{}}';
    return { body, etag: etagForBody(body) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      const body = '{"runs":{}}';
      return { body, etag: etagForBody(body), missing: true };
    }
    throw error;
  }
}

async function writeState(rawBody) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, rawBody, 'utf8');
  return etagForBody(rawBody);
}

function unauthorized(res) {
  json(res, 401, { error: 'Unauthorized' });
}

function isAuthorized(req) {
  if (!AUTH_TOKEN) return true;
  return req.headers.authorization === `Bearer ${AUTH_TOKEN}`;
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'PUT'].includes(req.method || '')) {
      json(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET, PUT' });
      return;
    }

    if (!isAuthorized(req)) {
      unauthorized(res);
      return;
    }

    if (req.method === 'GET') {
      const { body, etag, missing } = await readState();
      if (missing) {
        json(res, 404, { error: 'Not Found' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ETag: etag,
      });
      res.end(body);
      return;
    }

    const incomingBody = await collectBody(req);
    let parsed;
    try {
      parsed = incomingBody ? JSON.parse(incomingBody) : {};
    } catch {
      json(res, 400, { error: 'Invalid JSON body.' });
      return;
    }

    const normalized = JSON.stringify(parsed);
    const { etag: currentEtag, missing } = await readState();
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];

    if (ifMatch && ifMatch !== currentEtag) {
      json(res, 412, { error: 'ETag mismatch.' });
      return;
    }

    if (ifNoneMatch === '*' && !missing) {
      json(res, 412, { error: 'Store already exists.' });
      return;
    }

    const nextEtag = await writeState(normalized);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ETag: nextEtag,
    });
    res.end(normalized);
  } catch (error) {
    json(res, 500, { error: 'Internal Server Error', details: error.message });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`durable-run-store listening on :${PORT} (path: ${STORE_PATH})`);
});
