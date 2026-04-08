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

async function triggerQueue(functionName) {
  const timeoutMs = Math.max(200, Number(process.env.QUEUE_TRIGGER_TIMEOUT_MS || 1500));
  const targetUrl = new URL(`/.netlify/functions/${functionName}`, resolveBaseUrl()).toString();
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
      console.warn('Immediate queue trigger failed.', { functionName, status: response.status });
      return { ok: false, statusCode: response.status };
    }
    return { ok: true, statusCode: response.status };
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Immediate queue trigger threw an error.', { functionName, error: error?.message || error });
    }
    return { ok: false, statusCode: error?.name === 'AbortError' ? 408 : 500 };
  } finally {
    clearTimeout(timeout);
  }
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
