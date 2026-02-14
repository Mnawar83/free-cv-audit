const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = process.env.RUN_STORE_PATH || '/tmp/free-cv-audit-runs.json';
const RUN_STORE_DURABLE_URL = process.env.RUN_STORE_DURABLE_URL || '';
const RUN_STORE_DURABLE_TOKEN = process.env.RUN_STORE_DURABLE_TOKEN || '';

const LINKEDIN_UPSELL_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  GENERATED: 'GENERATED',
};

function isProductionRuntime() {
  return process.env.CONTEXT === 'production' || process.env.NETLIFY === 'true';
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

async function readStoreFromDurable() {
  const response = await fetch(RUN_STORE_DURABLE_URL, {
    method: 'GET',
    headers: getDurableHeaders(),
  });

  if (response.status === 404) {
    return getDefaultStore();
  }
  if (!response.ok) {
    throw new Error(`Durable run store read failed with status ${response.status}.`);
  }

  const text = await response.text();
  if (!text.trim()) return getDefaultStore();
  return normalizeStore(JSON.parse(text));
}

async function writeStoreToDurable(store) {
  const response = await fetch(RUN_STORE_DURABLE_URL, {
    method: 'PUT',
    headers: getDurableHeaders(),
    body: JSON.stringify(store),
  });

  if (!response.ok) {
    throw new Error(`Durable run store write failed with status ${response.status}.`);
  }
}

async function readStoreFromFile() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') return getDefaultStore();
    throw error;
  }
}

async function writeStoreToFile(store) {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

async function readStore() {
  if (RUN_STORE_DURABLE_URL) {
    return readStoreFromDurable();
  }

  if (isProductionRuntime()) {
    throw new Error(
      'Durable run storage is required in production. Configure RUN_STORE_DURABLE_URL (and RUN_STORE_DURABLE_TOKEN if needed).',
    );
  }

  return readStoreFromFile();
}

async function writeStore(store) {
  if (RUN_STORE_DURABLE_URL) {
    await writeStoreToDurable(store);
    return;
  }

  if (isProductionRuntime()) {
    throw new Error(
      'Durable run storage is required in production. Configure RUN_STORE_DURABLE_URL (and RUN_STORE_DURABLE_TOKEN if needed).',
    );
  }

  await writeStoreToFile(store);
}

async function upsertRun(runId, updates = {}) {
  const store = await readStore();
  const existing = store.runs[runId] || {
    runId,
    created_at: new Date().toISOString(),
    linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.NOT_STARTED,
  };

  store.runs[runId] = {
    ...existing,
    ...updates,
    runId,
    updated_at: new Date().toISOString(),
  };

  await writeStore(store);
  return store.runs[runId];
}

async function getRun(runId) {
  const store = await readStore();
  return store.runs[runId] || null;
}

async function updateRun(runId, updater) {
  const store = await readStore();
  const existing = store.runs[runId];
  if (!existing) return null;

  const next = {
    ...existing,
    ...updater(existing),
    updated_at: new Date().toISOString(),
  };

  store.runs[runId] = next;
  await writeStore(store);
  return next;
}

function createRunId() {
  return crypto.randomUUID();
}

module.exports = {
  LINKEDIN_UPSELL_STATUS,
  createRunId,
  getRun,
  upsertRun,
  updateRun,
};
