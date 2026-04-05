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
  return { runs: {}, emailDownloads: {}, emailDeliveries: {}, rateLimits: {}, emailQueue: [], webhookEvents: {} };
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
    return {
      ...parsed,
      runs: {},
      emailDownloads:
        parsed.emailDownloads && typeof parsed.emailDownloads === 'object'
          ? parsed.emailDownloads
          : {},
      emailDeliveries:
        parsed.emailDeliveries && typeof parsed.emailDeliveries === 'object'
          ? parsed.emailDeliveries
          : {},
      rateLimits:
        parsed.rateLimits && typeof parsed.rateLimits === 'object'
          ? parsed.rateLimits
          : {},
      emailQueue: Array.isArray(parsed.emailQueue) ? parsed.emailQueue : [],
      webhookEvents:
        parsed.webhookEvents && typeof parsed.webhookEvents === 'object'
          ? parsed.webhookEvents
          : {},
    };
  }
  if (!parsed.emailDownloads || typeof parsed.emailDownloads !== 'object') {
    return {
      ...parsed,
      emailDownloads: {},
      emailDeliveries: parsed.emailDeliveries && typeof parsed.emailDeliveries === 'object' ? parsed.emailDeliveries : {},
      rateLimits: parsed.rateLimits && typeof parsed.rateLimits === 'object' ? parsed.rateLimits : {},
      emailQueue: Array.isArray(parsed.emailQueue) ? parsed.emailQueue : [],
      webhookEvents: parsed.webhookEvents && typeof parsed.webhookEvents === 'object' ? parsed.webhookEvents : {},
    };
  }
  if (!parsed.emailDeliveries || typeof parsed.emailDeliveries !== 'object') {
    return {
      ...parsed,
      emailDeliveries: {},
      rateLimits: parsed.rateLimits && typeof parsed.rateLimits === 'object' ? parsed.rateLimits : {},
      emailQueue: Array.isArray(parsed.emailQueue) ? parsed.emailQueue : [],
      webhookEvents: parsed.webhookEvents && typeof parsed.webhookEvents === 'object' ? parsed.webhookEvents : {},
    };
  }
  if (!parsed.rateLimits || typeof parsed.rateLimits !== 'object') {
    return {
      ...parsed,
      rateLimits: {},
      emailQueue: Array.isArray(parsed.emailQueue) ? parsed.emailQueue : [],
      webhookEvents: parsed.webhookEvents && typeof parsed.webhookEvents === 'object' ? parsed.webhookEvents : {},
    };
  }
  if (!Array.isArray(parsed.emailQueue)) {
    return {
      ...parsed,
      emailQueue: [],
      webhookEvents: parsed.webhookEvents && typeof parsed.webhookEvents === 'object' ? parsed.webhookEvents : {},
    };
  }
  if (!parsed.webhookEvents || typeof parsed.webhookEvents !== 'object') {
    return { ...parsed, webhookEvents: {} };
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

function createEmailDownloadToken() {
  return crypto.randomUUID();
}

function pruneExpiredEmailDownloads(store) {
  if (!store?.emailDownloads || typeof store.emailDownloads !== 'object') return;
  const now = Date.now();
  for (const [token, snapshot] of Object.entries(store.emailDownloads)) {
    const expiresAtMs = snapshot?.expires_at ? new Date(snapshot.expires_at).getTime() : null;
    if (Number.isFinite(expiresAtMs) && expiresAtMs < now) {
      delete store.emailDownloads[token];
    }
  }
}

async function upsertEmailDownload(token, payload = {}) {
  return mutateStore((store) => {
    pruneExpiredEmailDownloads(store);
    const existing = store.emailDownloads[token] || { token, created_at: new Date().toISOString() };
    const next = {
      ...existing,
      ...payload,
      token,
      updated_at: new Date().toISOString(),
    };
    store.emailDownloads[token] = next;
    return { value: next };
  });
}

async function getEmailDownload(token) {
  const { store } = await readStoreWithMeta();
  return store.emailDownloads[token] || null;
}

async function upsertEmailDelivery(deliveryKey, payload = {}) {
  return mutateStore((store) => {
    const existing = store.emailDeliveries[deliveryKey] || { deliveryKey, created_at: new Date().toISOString() };
    const next = {
      ...existing,
      ...payload,
      deliveryKey,
      updated_at: new Date().toISOString(),
    };
    store.emailDeliveries[deliveryKey] = next;
    return { value: next };
  });
}

async function findEmailDeliveryByProviderId(providerId) {
  const { store } = await readStoreWithMeta();
  return Object.values(store.emailDeliveries).find((item) => item?.provider_email_id === providerId) || null;
}

async function takeRateLimitSlot(key, windowMs, maxRequests) {
  return mutateStore((store) => {
    const safeWindowMs = Math.max(1_000, Number(windowMs) || 60_000);
    const safeMax = Math.max(1, Number(maxRequests) || 30);
    const now = Date.now();

    for (const [entryKey, value] of Object.entries(store.rateLimits || {})) {
      if (!value?.window_start || now - value.window_start > safeWindowMs * 2) {
        delete store.rateLimits[entryKey];
      }
    }

    const current = store.rateLimits[key];
    if (!current || now - current.window_start > safeWindowMs) {
      store.rateLimits[key] = { window_start: now, count: 1 };
      return { value: { limited: false, remaining: safeMax - 1 } };
    }

    const nextCount = (Number(current.count) || 0) + 1;
    store.rateLimits[key] = {
      window_start: current.window_start,
      count: nextCount,
    };

    return {
      value: {
        limited: nextCount > safeMax,
        remaining: Math.max(0, safeMax - nextCount),
      },
    };
  });
}

async function enqueueEmailJob(payload) {
  return mutateStore((store) => {
    const job = {
      id: crypto.randomUUID(),
      status: 'PENDING',
      payload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.emailQueue.push(job);
    return { value: job };
  });
}

function getProcessingLeaseMs() {
  return Math.max(30_000, Number(process.env.CV_EMAIL_QUEUE_PROCESSING_LEASE_MS || 5 * 60 * 1000));
}

function requeueStaleProcessingJobs(store, now) {
  const leaseMs = getProcessingLeaseMs();
  let requeued = 0;

  store.emailQueue = (store.emailQueue || []).map((job) => {
    if (job?.status !== 'PROCESSING') return job;
    const updatedAtMs = job?.updated_at ? new Date(job.updated_at).getTime() : null;
    const createdAtMs = job?.created_at ? new Date(job.created_at).getTime() : now;
    const lastSeenMs = Number.isFinite(updatedAtMs) ? updatedAtMs : createdAtMs;
    if (now - lastSeenMs <= leaseMs) return job;
    requeued += 1;
    return {
      ...job,
      status: 'RETRY',
      next_attempt_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      last_error: 'Recovered stale PROCESSING job after lease timeout.',
    };
  });

  return requeued;
}

async function claimEmailJob() {
  return mutateStore((store) => {
    const now = Date.now();
    const requeued = requeueStaleProcessingJobs(store, now);

    const index = store.emailQueue.findIndex((job) =>
      job?.status === 'PENDING' ||
      (job?.status === 'RETRY' && (!job?.next_attempt_at || new Date(job.next_attempt_at).getTime() <= now)),
    );
    if (index < 0) {
      return requeued > 0 ? { value: null } : { value: null, skipWrite: true };
    }
    const current = store.emailQueue[index];
    const next = {
      ...current,
      status: 'PROCESSING',
      attempts: (Number(current.attempts) || 0) + 1,
      updated_at: new Date().toISOString(),
    };
    store.emailQueue[index] = next;
    return { value: next };
  });
}

async function completeEmailJob(jobId, updates = {}) {
  return mutateStore((store) => {
    const index = store.emailQueue.findIndex((job) => job?.id === jobId);
    if (index < 0) return { value: null, skipWrite: true };
    const current = store.emailQueue[index];
    const next = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    store.emailQueue[index] = next;
    return { value: next };
  });
}


async function isWebhookEventProcessed(eventId) {
  const key = String(eventId || '').trim();
  if (!key) return false;
  const { store } = await readStoreWithMeta();
  const existing = store.webhookEvents?.[key];
  if (!existing?.expires_at_ms) return false;
  return existing.expires_at_ms >= Date.now();
}

async function markWebhookEventProcessed(eventId, ttlMs = 86_400_000) {
  return mutateStore((store) => {
    const now = Date.now();
    const safeTtlMs = Math.max(60_000, Number(ttlMs) || 86_400_000);

    for (const [key, value] of Object.entries(store.webhookEvents || {})) {
      if (!value?.expires_at_ms || value.expires_at_ms < now) {
        delete store.webhookEvents[key];
      }
    }

    if (store.webhookEvents[eventId]) {
      return { value: { duplicate: true }, skipWrite: true };
    }

    store.webhookEvents[eventId] = {
      seen_at_ms: now,
      expires_at_ms: now + safeTtlMs,
    };
    return { value: { duplicate: false } };
  });
}

async function pruneOperationalData(options = {}) {
  return mutateStore((store) => {
    const now = Date.now();
    const deadLetterRetentionMs = Math.max(60_000, Number(options.deadLetterRetentionMs) || 7 * 24 * 60 * 60 * 1000);
    const completedRetentionMs = Math.max(60_000, Number(options.completedRetentionMs) || 7 * 24 * 60 * 60 * 1000);

    let removedDownloads = 0;
    for (const [token, snapshot] of Object.entries(store.emailDownloads || {})) {
      const expiresAtMs = snapshot?.expires_at ? new Date(snapshot.expires_at).getTime() : null;
      if (Number.isFinite(expiresAtMs) && expiresAtMs < now) {
        delete store.emailDownloads[token];
        removedDownloads += 1;
      }
    }

    let removedWebhookEvents = 0;
    for (const [eventId, eventState] of Object.entries(store.webhookEvents || {})) {
      if (!eventState?.expires_at_ms || eventState.expires_at_ms < now) {
        delete store.webhookEvents[eventId];
        removedWebhookEvents += 1;
      }
    }

    let removedQueueJobs = 0;
    store.emailQueue = (store.emailQueue || []).filter((job) => {
      const updatedAtMs = job?.updated_at ? new Date(job.updated_at).getTime() : now;
      const ageMs = now - updatedAtMs;
      if (job?.status === 'DEAD_LETTER' && ageMs > deadLetterRetentionMs) {
        removedQueueJobs += 1;
        return false;
      }
      if (job?.status === 'COMPLETED' && ageMs > completedRetentionMs) {
        removedQueueJobs += 1;
        return false;
      }
      return true;
    });

    return {
      value: {
        removedDownloads,
        removedWebhookEvents,
        removedQueueJobs,
      },
    };
  });
}

async function getOperationalStats() {
  const { store } = await readStoreWithMeta();
  const queue = Array.isArray(store.emailQueue) ? store.emailQueue : [];
  const now = Date.now();
  const pendingJobs = queue.filter((job) => job?.status === 'PENDING');
  const retryJobs = queue.filter((job) => job?.status === 'RETRY');
  const deadLetterJobs = queue.filter((job) => job?.status === 'DEAD_LETTER');
  const completedJobs = queue.filter((job) => job?.status === 'COMPLETED');

  let oldestPendingAgeMs = 0;
  pendingJobs.forEach((job) => {
    const createdAtMs = job?.created_at ? new Date(job.created_at).getTime() : now;
    oldestPendingAgeMs = Math.max(oldestPendingAgeMs, now - createdAtMs);
  });

  return {
    queue: {
      total: queue.length,
      pending: pendingJobs.length,
      retry: retryJobs.length,
      deadLetter: deadLetterJobs.length,
      completed: completedJobs.length,
      oldestPendingAgeMs,
    },
    deliveries: {
      total: Object.keys(store.emailDeliveries || {}).length,
    },
    downloads: {
      total: Object.keys(store.emailDownloads || {}).length,
    },
    webhookEvents: {
      total: Object.keys(store.webhookEvents || {}).length,
    },
  };
}

module.exports = {
  COVER_LETTER_PRICE_USD,
  COVER_LETTER_STATUS,
  LINKEDIN_UPSELL_STATUS,
  createRunId,
  createEmailDownloadToken,
  claimEmailJob,
  completeEmailJob,
  enqueueEmailJob,
  findEmailDeliveryByProviderId,
  getEmailDownload,
  getRun,
  isWebhookEventProcessed,
  markWebhookEventProcessed,
  getOperationalStats,
  pruneOperationalData,
  takeRateLimitSlot,
  upsertEmailDelivery,
  upsertEmailDownload,
  upsertRun,
  updateRun,
};
