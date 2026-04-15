function resolveBaseUrl() {
  const configured = String(process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '').trim();
  if (!configured) return 'https://freecvaudit.com';
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

function getQueueHeaders() {
  const secret = String(process.env.QUEUE_PROCESSOR_SECRET || '').trim();
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

function canUseDirectFallback() {
  return String(process.env.QUEUE_TRIGGER_DIRECT_FALLBACK || 'true').trim().toLowerCase() !== 'false';
}

function isTransientTriggerStatus(statusCode) {
  const code = Number(statusCode);
  return code === 408 || code === 429 || (code >= 500 && code <= 599);
}

async function invokeQueueHandlerDirectly(functionName) {
  try {
    const event = {
      httpMethod: 'POST',
      headers: getQueueHeaders(),
      body: '',
    };
    if (functionName === 'process-fulfillment-queue') {
      const handler = require('./process-fulfillment-queue').handler;
      const response = await handler(event);
      return { ok: response?.statusCode >= 200 && response?.statusCode < 300, statusCode: response?.statusCode || 500, direct: true };
    }
    if (functionName === 'process-email-queue') {
      const handler = require('./process-email-queue').handler;
      const response = await handler(event);
      return { ok: response?.statusCode >= 200 && response?.statusCode < 300, statusCode: response?.statusCode || 500, direct: true };
    }
  } catch (error) {
    console.warn('Direct queue trigger fallback failed.', { functionName, error: error?.message || error });
  }
  return { ok: false, statusCode: 500, direct: true };
}

async function triggerQueue(functionName) {
  const timeoutMs = Math.max(200, Number(process.env.QUEUE_TRIGGER_TIMEOUT_MS || 1500));
  const targetUrl = new URL(`/.netlify/functions/${functionName}`, resolveBaseUrl()).toString();
  const maxAttempts = Math.max(1, Number(process.env.QUEUE_TRIGGER_MAX_ATTEMPTS || 2));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: getQueueHeaders(),
        body: '',
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn('Immediate queue trigger failed.', { functionName, status: response.status, attempt, maxAttempts });
        if (attempt < maxAttempts && isTransientTriggerStatus(response.status)) {
          continue;
        }
        if (canUseDirectFallback() && isTransientTriggerStatus(response.status)) {
          return invokeQueueHandlerDirectly(functionName);
        }
        return { ok: false, statusCode: response.status };
      }
      return { ok: true, statusCode: response.status };
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Immediate queue trigger threw an error.', { functionName, attempt, maxAttempts, error: error?.message || error });
      }
      if (attempt < maxAttempts) {
        continue;
      }
      if (canUseDirectFallback()) {
        return invokeQueueHandlerDirectly(functionName);
      }
      return { ok: false, statusCode: error?.name === 'AbortError' ? 408 : 500 };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, statusCode: 500 };
}

async function triggerFulfillmentQueueProcessing() {
  return triggerQueue('process-fulfillment-queue');
}

async function triggerEmailQueueProcessing() {
  return triggerQueue('process-email-queue');
}

module.exports = {
  triggerFulfillmentQueueProcessing,
  triggerEmailQueueProcessing,
};
