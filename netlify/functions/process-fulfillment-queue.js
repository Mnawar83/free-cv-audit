const crypto = require('crypto');
const {
  claimFulfillmentJob,
  completeFulfillmentJob,
  getFulfillment,
  getRun,
  updateFulfillment,
  upsertRun,
} = require('./run-store');
const { runFullAudit } = require('./full-audit');

function isTransientStatus(statusCode) {
  const code = Number(statusCode);
  return code === 429 || (code >= 500 && code <= 599);
}

function shouldRetry(job, maxAttempts, statusCode, defaultTransient = false) {
  const attempts = job?.attempts || 1;
  const transient = Number.isFinite(Number(statusCode))
    ? isTransientStatus(statusCode) || defaultTransient
    : defaultTransient;
  return attempts < maxAttempts && transient;
}

function getRetryDelayMs(attempts) {
  return Math.min(60_000, Math.max(1_000, 1_000 * Math.pow(2, Math.max(0, (attempts || 1) - 1))));
}

function hasQueueAccess(headers = {}) {
  const expectedSecret = String(process.env.QUEUE_PROCESSOR_SECRET || '').trim();
  if (!expectedSecret) return true;
  const authHeader = String(headers.authorization || headers.Authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) return false;
  const providedSecret = authHeader.slice('Bearer '.length).trim();
  const expectedBuf = Buffer.from(expectedSecret);
  const providedBuf = Buffer.from(providedSecret);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!hasQueueAccess(event.headers || {})) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const maxJobs = Math.max(1, Number(process.env.FULFILLMENT_QUEUE_BATCH_SIZE || 10));
  const maxAttempts = Math.max(1, Number(process.env.FULFILLMENT_QUEUE_MAX_ATTEMPTS || 3));
  const processed = [];

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimFulfillmentJob();
    if (!job) break;

    try {
      const payload = job.payload || {};
      const fulfillmentId = String(payload.fulfillmentId || '').trim();
      const requestedEmail = String(payload.email || '').trim().toLowerCase();
      const name = String(payload.name || '').trim();
      if (!fulfillmentId) {
        await completeFulfillmentJob(job.id, { status: 'DEAD_LETTER', last_status_code: 400, last_response_body: JSON.stringify({ error: 'fulfillmentId is required.' }) });
        processed.push({ jobId: job.id, status: 'DEAD_LETTER', reason: 'MISSING_FULFILLMENT_ID' });
        continue;
      }

      const fulfillment = await getFulfillment(fulfillmentId);
      if (!fulfillment) {
        await completeFulfillmentJob(job.id, { status: 'DEAD_LETTER', last_status_code: 404, last_response_body: JSON.stringify({ error: 'fulfillment was not found.' }) });
        processed.push({ jobId: job.id, status: 'DEAD_LETTER', fulfillmentId, reason: 'FULFILLMENT_NOT_FOUND' });
        continue;
      }
      if (String(fulfillment.payment_status || '').toUpperCase() !== 'PAID') {
        const retryable = shouldRetry(job, maxAttempts, 409, true);
        await completeFulfillmentJob(job.id, {
          status: retryable ? 'RETRY' : 'DEAD_LETTER',
          next_attempt_at: retryable ? new Date(Date.now() + getRetryDelayMs(job.attempts || 1)).toISOString() : null,
          last_status_code: 409,
          last_response_body: JSON.stringify({ error: 'Payment not confirmed yet.' }),
        });
        processed.push({ jobId: job.id, status: retryable ? 'RETRY' : 'DEAD_LETTER', fulfillmentId });
        continue;
      }
      if (String(fulfillment.email_status || '').toUpperCase() === 'SENT') {
        await completeFulfillmentJob(job.id, { status: 'COMPLETED', last_status_code: 208, last_response_body: JSON.stringify({ ok: true, duplicate: true }) });
        processed.push({ jobId: job.id, status: 'COMPLETED', fulfillmentId, duplicate: true });
        continue;
      }

      const runId = String(fulfillment.run_id || '').trim();
      const run = await getRun(runId);
      if (!run?.original_cv_text) {
        throw new Error('Original CV text is missing for paid fulfillment.');
      }

      console.log('[full-audit] running', { runId, fulfillmentId });
      await updateFulfillment(fulfillmentId, { processing_status: 'full_audit_running' });
      await upsertRun(runId, { fulfillment_status: 'full_audit_running' });
      const fullAudit = await runFullAudit(runId, run.original_cv_text, run.audit_result || '');
      await upsertRun(runId, {
        full_audit_result: fullAudit,
        fulfillment_status: 'cv_generation_running',
        full_audit_completed_at: new Date().toISOString(),
      });

      console.log('[cv-generation] generating structured CV', { runId, fulfillmentId });
      const generatePdfHandler = require('./generate-pdf').handler;
      const genResponse = await generatePdfHandler({
        httpMethod: 'POST',
        body: JSON.stringify({ runId, cvText: run.original_cv_text, cvAnalysis: JSON.stringify(fullAudit), forceRegenerate: true }),
      });
      if (!(genResponse?.statusCode >= 200 && genResponse?.statusCode < 300)) {
        throw new Error(`CV generation failed with status ${genResponse?.statusCode || 500}`);
      }
      if (!genResponse?.isBase64Encoded || !String(genResponse?.body || '').trim()) {
        throw new Error('CV generation did not return a final PDF attachment payload.');
      }

      const generatedRunIdHeader = String(
        genResponse?.headers?.['x-run-id']
        || genResponse?.headers?.['X-Run-Id']
        || (typeof genResponse?.headers?.get === 'function' ? genResponse.headers.get('x-run-id') : ''),
      ).trim();
      const effectiveRunId = generatedRunIdHeader || runId;
      if (generatedRunIdHeader && generatedRunIdHeader !== runId) {
        console.log('[cv-generation] runId rotated during regeneration', {
          previousRunId: runId,
          newRunId: generatedRunIdHeader,
          fulfillmentId,
        });
        await updateFulfillment(fulfillmentId, {
          run_id: generatedRunIdHeader,
        });
      }

      await upsertRun(effectiveRunId, { fulfillment_status: 'cv_ready', cv_ready_at: new Date().toISOString() });

      const email = requestedEmail || String(fulfillment.email || '').trim();
      if (!email) throw new Error('Email is required for fulfillment send.');
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || 'https://freecvaudit.com';
      const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
      const cvUrl = new URL(`/.netlify/functions/generate-pdf?runId=${encodeURIComponent(effectiveRunId)}`, normalizedBaseUrl).toString();

      console.log('[email-delivery] sending', { runId: effectiveRunId, fulfillmentId });
      await updateFulfillment(fulfillmentId, { processing_status: 'email_sending' });
      await upsertRun(effectiveRunId, { fulfillment_status: 'email_sending' });
      const sendHandler = require('./send-cv-email').handler;
      const response = await sendHandler({
        httpMethod: 'POST',
        body: JSON.stringify({ email, name, cvUrl, runId: effectiveRunId, fulfillmentId, resend: false, forceSync: true }),
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        await updateFulfillment(fulfillmentId, {
          email_status: 'SENT',
          email_sent_at: new Date().toISOString(),
          processing_status: 'email_sent',
        });
        await upsertRun(effectiveRunId, { fulfillment_status: 'email_sent', email_sent_at: new Date().toISOString() });
        await completeFulfillmentJob(job.id, { status: 'COMPLETED', last_status_code: response.statusCode, last_response_body: response.body || '' });
        processed.push({ jobId: job.id, status: 'COMPLETED', fulfillmentId, runId: effectiveRunId });
      } else {
        throw new Error(`Email delivery failed with status ${response.statusCode}`);
      }
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      const retryable = shouldRetry(job, maxAttempts, statusCode, true);
      await completeFulfillmentJob(job.id, {
        status: retryable ? 'RETRY' : 'DEAD_LETTER',
        next_attempt_at: retryable ? new Date(Date.now() + getRetryDelayMs(job.attempts || 1)).toISOString() : null,
        last_status_code: statusCode,
        last_response_body: JSON.stringify({ error: error.message || 'Fulfillment queue processing failed.' }),
      });
      processed.push({ jobId: job.id, status: retryable ? 'RETRY' : 'DEAD_LETTER' });
    }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, processed }) };
};
