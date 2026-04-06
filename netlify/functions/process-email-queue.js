const { claimEmailJob, completeEmailJob } = require('./run-store');

function isTransientStatus(statusCode) {
  const code = Number(statusCode);
  return code === 429 || (code >= 500 && code <= 599);
}

function shouldRetryJob(job, maxAttempts, statusCode, defaultTransient = false) {
  const attempts = job?.attempts || 1;
  const transient = Number.isFinite(Number(statusCode)) ? isTransientStatus(statusCode) : defaultTransient;
  return attempts < maxAttempts && transient;
}

function getRetryDelayMs(attempts) {
  return Math.min(60_000, Math.max(1_000, 1_000 * Math.pow(2, Math.max(0, (attempts || 1) - 1))));
}


function hasQueueAccess(headers = {}) {
  const expectedSecret = String(process.env.QUEUE_PROCESSOR_SECRET || '').trim();
  if (!expectedSecret) return false;

  const authHeader = String(headers.authorization || headers.Authorization || '').trim();
  const bearerPrefix = 'Bearer ';
  if (!authHeader.startsWith(bearerPrefix)) return false;
  const providedSecret = authHeader.slice(bearerPrefix.length).trim();
  return providedSecret.length > 0 && providedSecret === expectedSecret;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!hasQueueAccess(event.headers || {})) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const maxJobs = Math.max(1, Number(process.env.CV_EMAIL_QUEUE_BATCH_SIZE || 10));
  const maxAttempts = Math.max(1, Number(process.env.CV_EMAIL_QUEUE_MAX_ATTEMPTS || 3));
  const processed = [];
  let deadLetterCount = 0;
  let retryCount = 0;
  let completedCount = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimEmailJob();
    if (!job) break;

    try {
      const sendHandler = require('./send-cv-email').handler;
      const response = await sendHandler({
        httpMethod: 'POST',
        body: JSON.stringify({
          ...job.payload,
          forceSync: true,
        }),
      });
      const success = response.statusCode >= 200 && response.statusCode < 300;
      const fulfillmentId = job?.payload?.fulfillmentId || null;
      if (success) {
        await completeEmailJob(job.id, {
          status: 'COMPLETED',
          last_status_code: response.statusCode,
          last_response_body: response.body || '',
        });
        processed.push({ jobId: job.id, status: 'COMPLETED', fulfillmentId });
        completedCount += 1;
      } else {
        const shouldRetry = shouldRetryJob(job, maxAttempts, response.statusCode);
        const retryDelayMs = getRetryDelayMs(job.attempts || 1);
        await completeEmailJob(job.id, {
          status: shouldRetry ? 'RETRY' : 'DEAD_LETTER',
          next_attempt_at: shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null,
          last_status_code: response.statusCode,
          last_response_body: response.body || '',
        });
        processed.push({ jobId: job.id, status: shouldRetry ? 'RETRY' : 'DEAD_LETTER', fulfillmentId });
        if (shouldRetry) retryCount += 1;
        else deadLetterCount += 1;
      }
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      const shouldRetry = shouldRetryJob(job, maxAttempts, statusCode, true);
      const retryDelayMs = getRetryDelayMs(job.attempts || 1);
      await completeEmailJob(job.id, {
        status: shouldRetry ? 'RETRY' : 'DEAD_LETTER',
        next_attempt_at: shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null,
        last_status_code: statusCode,
        last_response_body: JSON.stringify({ error: error.message || 'Queue processing failed.' }),
      });
      const fulfillmentId = job?.payload?.fulfillmentId || null;
      processed.push({ jobId: job.id, status: shouldRetry ? 'RETRY' : 'DEAD_LETTER', fulfillmentId });
      if (shouldRetry) retryCount += 1;
      else deadLetterCount += 1;
    }
  }

  if (deadLetterCount > 0) {
    console.warn('CV email queue dead-letter entries created.', { deadLetterCount, maxJobs, maxAttempts });
  }
  console.info('CV email queue batch processed.', {
    processed: processed.length,
    completedCount,
    retryCount,
    deadLetterCount,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, processed }),
  };
};
