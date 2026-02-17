const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = process.env.RUN_STORE_PATH || '/tmp/free-cv-audit-runs.json';
const RUN_STORE_DURABLE_URL = process.env.RUN_STORE_DURABLE_URL || '';
const RUN_STORE_DURABLE_TOKEN = process.env.RUN_STORE_DURABLE_TOKEN || '';

function resolveDurableStoreUrl() {
  if (!RUN_STORE_DURABLE_URL) return '';

  if (/^https?:\/\//i.test(RUN_STORE_DURABLE_URL)) {
    return RUN_STORE_DURABLE_URL;
  }

  if (RUN_STORE_DURABLE_URL.startsWith('/')) {
    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '';
    if (!baseUrl) {
      throw new Error(
        'RUN_STORE_DURABLE_URL is relative, but no base URL is available. Set URL/DEPLOY_PRIME_URL/DEPLOY_URL or use an absolute RUN_STORE_DURABLE_URL.',
      );
    }

    return new URL(RUN_STORE_DURABLE_URL, baseUrl).toString();
  }

  throw new Error('RUN_STORE_DURABLE_URL must be an absolute http(s) URL or a root-relative path.');
}

const RESOLVED_RUN_STORE_DURABLE_URL = resolveDurableStoreUrl();

const LINKEDIN_UPSELL_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  GENERATED: 'GENERATED',
};

const COVER_LETTER_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  GENERATED: 'GENERATED',
};

const COVER_LETTER_PRICE_USD = 0.99;

const MAX_CONFLICT_RETRIES = 5;
const MAX_DURABLE_HTTP_RETRIES = 3;
const DURABLE_RETRY_STATUS_CODES = new Set([429, 502, 503, 504]);
let mutationQueue = Promise.resolve();

function isProductionRuntime() {
  return process.env.CONTEXT === 'production';
}

function getDefaultStore() {
  return { runs: {} };
}

function getDurableHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (RUN_STORE_DURABLE_TOKEN) {
    headers.Authorization = `Bearer ${RUN_STORE_DURABLE_TOKEN}`;
  }
  return headers;
}

function normalizeStore(parsed) {
  if (!parsed || typeof parsed !== 'object') return getDefaultStore();
  if (!parsed.runs || typeof parsed.runs !== 'object') {
    return { ...parsed, runs: {} };
  }
  return parsed;
}

function isConflictError(error) {
  return error && (error.code === 'STORE_WRITE_CONFLICT' || error.statusCode === 409 || error.statusCode === 412);
}

function shouldRetryDurableRequest(statusCode) {
  return DURABLE_RETRY_STATUS_CODES.has(statusCode);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDurableWithRetry(request) {
  let lastResponse = null;

  for (let attempt = 0; attempt < MAX_DURABLE_HTTP_RETRIES; attempt += 1) {
    const response = await fetch(RESOLVED_RUN_STORE_DURABLE_URL, request);
    lastResponse = response;

    if (!shouldRetryDurableRequest(response.status) || attempt === MAX_DURABLE_HTTP_RETRIES - 1) {
      return response;
    }

    await sleep((attempt + 1) * 150);
  }

  return lastResponse;
}

async function readResponseSummary(response) {
  const body = (await response.text()).trim();
  if (!body) return '';
  return body.length > 240 ? `${body.slice(0, 240)}…` : body;
}

async function readStoreFromDurable() {
  const response = await fetchDurableWithRetry({
    method: 'GET',
    headers: getDurableHeaders(),
  });

  if (response.status === 404) {
    return { store: getDefaultStore(), etag: null };
  }
  if (!response.ok) {
    const summary = await readResponseSummary(response);
    const details = summary ? ` Response: ${summary}` : '';
    throw new Error(`Durable run store read failed with status ${response.status}.${details}`);
  }

  const etag = response.headers.get('etag');
  const text = await response.text();
  if (!text.trim()) return { store: getDefaultStore(), etag };
  return { store: normalizeStore(JSON.parse(text)), etag };
}

async function writeStoreToDurable(store, etag) {
  const headers = getDurableHeaders();
  if (etag) {
    headers['If-Match'] = etag;
  } else {
    headers['If-None-Match'] = '*';
  }

  const response = await fetchDurableWithRetry({
    method: 'PUT',
    headers,
    body: JSON.stringify(store),
  });

  if (response.status === 409 || response.status === 412) {
    const conflictError = new Error('Durable run store write conflict.');
    conflictError.code = 'STORE_WRITE_CONFLICT';
    conflictError.statusCode = response.status;
    throw conflictError;
  }

  if (!response.ok) {
    const summary = await readResponseSummary(response);
    const details = summary ? ` Response: ${summary}` : '';
    throw new Error(`Durable run store write failed with status ${response.status}.${details}`);
  }
}

async function readStoreFromFile() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return { store: normalizeStore(JSON.parse(raw)), etag: null };
  } catch (error) {
    if (error.code === 'ENOENT') return { store: getDefaultStore(), etag: null };
    throw error;
  }
}

async function writeStoreToFile(store) {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

async function readStoreWithMeta() {
  if (RESOLVED_RUN_STORE_DURABLE_URL) {
    return readStoreFromDurable();
  }

  if (isProductionRuntime()) {
    throw new Error(
      'Durable run storage is required in production. Configure RUN_STORE_DURABLE_URL (and RUN_STORE_DURABLE_TOKEN if needed).',
    );
  }

  return readStoreFromFile();
}

async function writeStoreWithMeta(store, etag) {
  if (RESOLVED_RUN_STORE_DURABLE_URL) {
    await writeStoreToDurable(store, etag);
    return;
  }

  if (isProductionRuntime()) {
    throw new Error(
      'Durable run storage is required in production. Configure RUN_STORE_DURABLE_URL (and RUN_STORE_DURABLE_TOKEN if needed).',
    );
  }

  await writeStoreToFile(store);
}

function enqueueMutation(work) {
  const run = mutationQueue.then(work, work);
  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function mutateStore(mutator) {
  return enqueueMutation(async () => {
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
      const { store, etag } = await readStoreWithMeta();
      const result = mutator(store);
      if (result && result.skipWrite) {
        return result.value;
      }

      try {
        await writeStoreWithMeta(store, etag);
        return result ? result.value : null;
      } catch (error) {
        if (isConflictError(error) && attempt < MAX_CONFLICT_RETRIES - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Run store write conflict. Please retry.');
  });
}

async function upsertRun(runId, updates = {}) {
  return mutateStore((store) => {
    const existing = store.runs[runId] || {
      runId,
      created_at: new Date().toISOString(),
      linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.NOT_STARTED,
      cover_letter_status: COVER_LETTER_STATUS.NOT_STARTED,
      cover_letter_price_usd: COVER_LETTER_PRICE_USD,
    };

    const next = {
      ...existing,
      ...updates,
      runId,
      updated_at: new Date().toISOString(),
    };

    store.runs[runId] = next;
    return { value: next };
  });
}

async function getRun(runId) {
  const { store } = await readStoreWithMeta();
  return store.runs[runId] || null;
}

async function updateRun(runId, updater) {
  return mutateStore((store) => {
    const existing = store.runs[runId];
    if (!existing) return { value: null, skipWrite: true };

    const next = {
      ...existing,
      ...updater(existing),
      updated_at: new Date().toISOString(),
    };

    store.runs[runId] = next;
    return { value: next };
  });
}

function createRunId() {
  return crypto.randomUUID();
}

module.exports = {
  COVER_LETTER_PRICE_USD,
  COVER_LETTER_STATUS,
  LINKEDIN_UPSELL_STATUS,
  createRunId,
  getRun,
  upsertRun,
  updateRun,
};
