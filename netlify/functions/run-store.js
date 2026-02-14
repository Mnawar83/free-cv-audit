const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = process.env.RUN_STORE_PATH || '/tmp/free-cv-audit-runs.json';

const LINKEDIN_UPSELL_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  GENERATED: 'GENERATED',
};

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { runs: {} };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { runs: {} };
    }
    throw error;
  }
}

async function writeStore(store) {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

async function upsertRun(runId, updates = {}) {
  const store = await readStore();
  const existing = store.runs[runId] || {
    runId,
    created_at: new Date().toISOString(),
    linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.NOT_STARTED,
  };
  store.runs[runId] = { ...existing, ...updates, runId, updated_at: new Date().toISOString() };
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
  const next = { ...existing, ...updater(existing), updated_at: new Date().toISOString() };
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
