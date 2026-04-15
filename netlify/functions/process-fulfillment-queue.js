const crypto = require('crypto');
const {
  claimFulfillmentJob,
  completeFulfillmentJob,
  createArtifactToken,
  createEmailDownloadToken,
  getArtifactToken,
  getFulfillment,
  getRun,
  updateFulfillment,
  upsertRun,
} = require('./run-store');
const { buildPdfBuffer, buildPdfBufferFromStructuredCv } = require('./pdf-builder');
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

function isRetryableEmailDeliveryStatus(statusCode) {
  const code = Number(statusCode);
  if (code === 404 || code === 409 || code === 423 || code === 425) return true;
  return isTransientStatus(code);
}

function buildError(message, statusCode, options = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (options.transient) error.transient = true;
  return error;
}

function normalizeBase64Pdf(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw) return '';
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return '';
  return raw;
}

function prepareFinalPdfArtifact(run = {}, generatedPdfBase64 = '') {
  const generated = normalizeBase64Pdf(generatedPdfBase64);
  if (generated) return generated;
  const existingFinal = normalizeBase64Pdf(run?.final_cv_pdf_base64);
  if (existingFinal) return existingFinal;
  if (run?.revised_cv_structured) {
    try {
      return buildPdfBufferFromStructuredCv(run.revised_cv_structured).toString('base64');
    } catch (error) {
      console.warn('[artifact-prep] structured CV render failed; falling back to revised text render', {
        runId: run?.runId || null,
        error: error?.message || error,
      });
    }
  }
  const revisedText = String(run?.revised_cv_text || '').trim();
  if (revisedText) {
    return buildPdfBuffer(revisedText).toString('base64');
  }
  return '';
}

function isArtifactTokenUsable(tokenRecord) {
  if (!tokenRecord) return false;
  const expiresAtMs = tokenRecord.expires_at ? new Date(tokenRecord.expires_at).getTime() : null;
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return false;
  const maxDownloads = Math.max(0, Number(tokenRecord.max_downloads || 0));
  const downloadCount = Math.max(0, Number(tokenRecord.download_count || 0));
  if (maxDownloads > 0 && downloadCount >= maxDownloads) return false;
  return true;
}

function isReusableFullAudit(audit) {
  if (!audit || typeof audit !== 'object') return false;
  return Array.isArray(audit.auditFindings) && Array.isArray(audit.improvementNotes);
}

async function regenerateFinalPdfFromSource(runId, run, fullAuditResult) {
  const sourceCvText = String(run?.original_cv_text || '').trim();
  if (!sourceCvText) return '';
  const generatePdfHandler = require('./generate-pdf').handler;
  const response = await generatePdfHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      runId,
      cvText: sourceCvText,
      cvAnalysis: JSON.stringify(fullAuditResult || run?.full_audit_result || run?.audit_result || ''),
      forceRegenerate: true,
    }),
  });
  if (!(response?.statusCode >= 200 && response?.statusCode < 300)) {
    throw buildError(`Fallback CV regeneration failed with status ${response?.statusCode || 500}`, Number(response?.statusCode) || 500, { transient: true });
  }
  if (!response?.isBase64Encoded || !String(response?.body || '').trim()) {
    return '';
  }
  return normalizeBase64Pdf(response.body);
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
    const jobStartMs = Date.now();

    try {
      const payload = job.payload || {};
      const fulfillmentId = String(payload.fulfillmentId || '').trim();
      const requestedEmail = String(payload.email || '').trim().toLowerCase();
      const name = String(payload.name || '').trim();
      console.log('[fulfillment][queue] claimed', {
        jobId: job.id,
        fulfillmentId,
        attempts: job.attempts || 1,
        queueWaitMs: Math.max(0, jobStartMs - new Date(job.created_at || Date.now()).getTime()),
      });
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
      const paidAtMs = fulfillment?.paid_at ? new Date(fulfillment.paid_at).getTime() : null;
      const hasOriginalCvText = Boolean(String(run?.original_cv_text || '').trim());
      const hasLegacyDeliverable = Boolean(run?.revised_cv_structured || String(run?.revised_cv_text || '').trim());
      const runFulfillmentStatus = String(run?.fulfillment_status || '').trim().toLowerCase();
      const hasReusableGeneratedCv = Boolean(
        hasLegacyDeliverable
        || run?.revised_cv_generated_at
        || ['cv_ready', 'email_sending', 'email_sent'].includes(runFulfillmentStatus)
      );
      let effectiveRunId = runId;

      let generatedPdfBase64 = '';
      if (!hasOriginalCvText) {
        if (!hasLegacyDeliverable) {
          throw buildError('Original CV text is missing for paid fulfillment.', 409, { transient: true });
        }
        console.log('[cv-generation] legacy run detected without original CV text; using existing revised CV artifact for delivery', {
          runId,
          fulfillmentId,
        });
        await upsertRun(effectiveRunId, { fulfillment_status: 'cv_ready', cv_ready_at: new Date().toISOString() });
      } else {
        if (hasReusableGeneratedCv) {
          console.log('[fulfillment][cv-generation] reusing existing generated CV artifacts for retry delivery', { runId, fulfillmentId });
          await upsertRun(runId, { fulfillment_status: 'cv_ready', cv_ready_at: new Date().toISOString() });
        } else {
          console.log('[fulfillment][audit] start', { runId, fulfillmentId });
          const auditStartMs = Date.now();
          await updateFulfillment(fulfillmentId, { processing_status: 'full_audit_running' });
          await upsertRun(runId, { fulfillment_status: 'full_audit_running' });
          const cachedAudit = isReusableFullAudit(run?.full_audit_result) ? run.full_audit_result : null;
          const fullAudit = cachedAudit || await runFullAudit(runId, run.original_cv_text, run.audit_result || '');
          const auditEndMs = Date.now();
          console.log('[fulfillment][audit] complete', {
            runId,
            fulfillmentId,
            cached: Boolean(cachedAudit),
            elapsedMs: auditEndMs - auditStartMs,
          });
          await upsertRun(runId, {
            full_audit_result: fullAudit,
            fulfillment_status: 'cv_generation_running',
            full_audit_completed_at: new Date().toISOString(),
          });

          console.log('[fulfillment][cv-generation] start', { runId, fulfillmentId });
          const generationStartMs = Date.now();
          const generatePdfHandler = require('./generate-pdf').handler;
          const genResponse = await generatePdfHandler({
            httpMethod: 'POST',
            body: JSON.stringify({ runId, cvText: run.original_cv_text, cvAnalysis: JSON.stringify(fullAudit), forceRegenerate: true }),
          });
          if (!(genResponse?.statusCode >= 200 && genResponse?.statusCode < 300)) {
            throw buildError(`CV generation failed with status ${genResponse?.statusCode || 500}`, Number(genResponse?.statusCode) || 500, { transient: true });
          }
          if (!genResponse?.isBase64Encoded || !String(genResponse?.body || '').trim()) {
            throw buildError('CV generation did not return a final PDF attachment payload.', 500, { transient: true });
          }
          generatedPdfBase64 = normalizeBase64Pdf(genResponse.body);
          if (!generatedPdfBase64) {
            throw buildError('CV generation returned an invalid final PDF payload.', 500, { transient: true });
          }
          console.log('[fulfillment][cv-generation] complete', {
            runId,
            fulfillmentId,
            elapsedMs: Date.now() - generationStartMs,
          });

          const generatedRunIdHeader = String(
            genResponse?.headers?.['x-run-id']
            || genResponse?.headers?.['X-Run-Id']
            || (typeof genResponse?.headers?.get === 'function' ? genResponse.headers.get('x-run-id') : ''),
          ).trim();
          effectiveRunId = generatedRunIdHeader || runId;
          if (generatedRunIdHeader && generatedRunIdHeader !== runId) {
            console.log('[cv-generation] runId rotated during regeneration', {
              previousRunId: runId,
              newRunId: generatedRunIdHeader,
              fulfillmentId,
            });
            await updateFulfillment(fulfillmentId, {
              run_id: generatedRunIdHeader,
            });
            try {
              const rotatedRun = await getRun(generatedRunIdHeader);
              if (rotatedRun?.revised_cv_text || rotatedRun?.revised_cv_structured) {
                await upsertRun(runId, {
                  revised_cv_text: rotatedRun.revised_cv_text || null,
                  revised_cv_structured: rotatedRun.revised_cv_structured || null,
                  revised_cv_generated_at: rotatedRun.revised_cv_generated_at || new Date().toISOString(),
                  full_audit_result: rotatedRun.full_audit_result || null,
                  full_audit_completed_at: rotatedRun.full_audit_completed_at || null,
                  fulfillment_status: 'cv_ready',
                  fulfillment_rotated_run_id: generatedRunIdHeader,
                });
              }
            } catch (rotationSyncError) {
              console.warn('[cv-generation] failed to sync rotated run artifacts back to original run id', {
                previousRunId: runId,
                newRunId: generatedRunIdHeader,
                error: rotationSyncError?.message || rotationSyncError,
              });
            }
          }

          await upsertRun(effectiveRunId, { fulfillment_status: 'cv_ready', cv_ready_at: new Date().toISOString() });
        }
      }
      await upsertRun(runId, { fulfillment_status: 'cv_ready', cv_ready_at: new Date().toISOString() });

      let artifactRun = await getRun(effectiveRunId);
      const artifactBuildStartMs = Date.now();
      console.log('[fulfillment][artifact] build-start', { runId: effectiveRunId, fulfillmentId });
      let finalPdfBase64 = prepareFinalPdfArtifact(artifactRun, generatedPdfBase64);
      if (!finalPdfBase64) {
        console.warn('[fulfillment][artifact] cached artifact unavailable; attempting source regeneration fallback', {
          runId: effectiveRunId,
          fulfillmentId,
        });
        const regeneratedPdfBase64 = await regenerateFinalPdfFromSource(effectiveRunId, artifactRun, artifactRun?.full_audit_result || run?.full_audit_result);
        if (regeneratedPdfBase64) {
          generatedPdfBase64 = regeneratedPdfBase64;
          artifactRun = await getRun(effectiveRunId);
          finalPdfBase64 = prepareFinalPdfArtifact(artifactRun, regeneratedPdfBase64);
        }
      }
      if (!finalPdfBase64) {
        throw buildError('Final PDF artifact is missing and must be prepared before email delivery.', 425, { transient: true });
      }
      const existingArtifactToken = String(artifactRun?.final_cv_artifact_token || '').trim();
      const existingTokenRecord = existingArtifactToken ? await getArtifactToken(existingArtifactToken) : null;
      const shouldReuseArtifactToken = Boolean(
        existingArtifactToken
        && isArtifactTokenUsable(existingTokenRecord)
        && normalizeBase64Pdf(existingTokenRecord?.pdf_base64) === finalPdfBase64
      );
      const artifactToken = shouldReuseArtifactToken ? existingArtifactToken : createEmailDownloadToken();
      const rawTtl = Number(process.env.CV_EMAIL_LINK_TTL_DAYS || 30);
      const ttlDays = Math.min(90, Math.max(1, Number.isFinite(rawTtl) ? rawTtl : 30));
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
      if (!shouldReuseArtifactToken) {
        await createArtifactToken({
          token: artifactToken,
          runId: effectiveRunId,
          fulfillmentId,
          pdf_base64: finalPdfBase64,
          revised_cv_text: String(artifactRun?.revised_cv_text || '').trim() || null,
          expires_at: expiresAt,
        });
      }
      const shouldUpdateRunArtifact =
        normalizeBase64Pdf(artifactRun?.final_cv_pdf_base64) !== finalPdfBase64
        || String(artifactRun?.final_cv_artifact_token || '').trim() !== artifactToken
        || String(artifactRun?.fulfillment_status || '').trim().toLowerCase() !== 'artifact_persisted';
      if (shouldUpdateRunArtifact) {
        await upsertRun(effectiveRunId, {
          final_cv_pdf_base64: finalPdfBase64,
          final_cv_artifact_token: artifactToken,
          final_cv_artifact_ready_at: new Date().toISOString(),
          fulfillment_status: 'artifact_persisted',
        });
      }
      console.log('[fulfillment][artifact] build-complete', {
        runId: effectiveRunId,
        fulfillmentId,
        elapsedMs: Date.now() - artifactBuildStartMs,
        reusedToken: shouldReuseArtifactToken,
      });

      const email = requestedEmail || String(fulfillment.email || '').trim();
      if (!email) throw buildError('Email is required for fulfillment send.', 400);
      const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || 'https://freecvaudit.com';
      const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
      const cvUrl = new URL(`/.netlify/functions/generate-pdf?runId=${encodeURIComponent(effectiveRunId)}`, normalizedBaseUrl).toString();

      console.log('[fulfillment][email] handoff', { runId: effectiveRunId, fulfillmentId });
      await updateFulfillment(fulfillmentId, { processing_status: 'email_sending' });
      await upsertRun(effectiveRunId, { fulfillment_status: 'email_sending' });
      const sendHandler = require('./send-cv-email').handler;
      const emailSendStartMs = Date.now();
      console.log('[fulfillment][email] send-start', { runId: effectiveRunId, fulfillmentId });
      const response = await sendHandler({
        httpMethod: 'POST',
        body: JSON.stringify({
          email,
          name,
          cvUrl,
          runId: effectiveRunId,
          fulfillmentId,
          resend: false,
          forceSync: true,
          artifactToken,
          pdfBase64: finalPdfBase64,
        }),
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        const emailSendEndMs = Date.now();
        await updateFulfillment(fulfillmentId, {
          email_status: 'SENT',
          email_sent_at: new Date().toISOString(),
          processing_status: 'email_sent',
        });
        await upsertRun(effectiveRunId, { fulfillment_status: 'email_sent', email_sent_at: new Date().toISOString() });
        await completeFulfillmentJob(job.id, { status: 'COMPLETED', last_status_code: response.statusCode, last_response_body: response.body || '' });
        console.log('[fulfillment][email] send-complete', {
          runId: effectiveRunId,
          fulfillmentId,
          elapsedMs: emailSendEndMs - emailSendStartMs,
          totalSincePaidMs: Number.isFinite(paidAtMs) ? Math.max(0, emailSendEndMs - paidAtMs) : null,
          totalJobMs: emailSendEndMs - jobStartMs,
        });
        processed.push({ jobId: job.id, status: 'COMPLETED', fulfillmentId, runId: effectiveRunId });
      } else {
        const responseStatus = Number(response.statusCode) || 500;
        throw buildError(`Email delivery failed with status ${responseStatus}`, responseStatus, {
          transient: isRetryableEmailDeliveryStatus(responseStatus),
        });
      }
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      const retryable = shouldRetry(job, maxAttempts, statusCode, Boolean(error?.transient));
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
