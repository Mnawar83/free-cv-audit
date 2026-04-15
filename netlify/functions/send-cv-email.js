const {
  createArtifactToken,
  createEmailDownloadToken,
  enqueueEmailJob,
  getFulfillment,
  getArtifactToken,
  getRun,
  updateFulfillment,
  upsertRun,
  upsertEmailDelivery,
} = require('./run-store');
const { triggerEmailQueueProcessing } = require('./queue-trigger');
const crypto = require('crypto');
const QUALITY_FLOOR_DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);

function isQualityFloorEnabled() {
  const explicit = String(process.env.CV_QUALITY_FLOOR_MODE || '').trim().toLowerCase();
  if (explicit) return !QUALITY_FLOOR_DISABLED_VALUES.has(explicit);
  return true;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function toSafeText(value, fallback = '') {
  const trimmed = String(value || '').trim();
  return trimmed || fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveRunId(runId, cvUrl) {
  const directRunId = toSafeText(runId);
  if (directRunId) return directRunId;
  try {
    const parsed = new URL(cvUrl, 'https://freecvaudit.com');
    return toSafeText(parsed.searchParams.get('runId'));
  } catch (error) {
    return '';
  }
}

function resolveBaseUrl(cvUrl) {
  const configured =
    toSafeText(process.env.URL) ||
    toSafeText(process.env.DEPLOY_PRIME_URL) ||
    toSafeText(process.env.DEPLOY_URL);
  if (configured) {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return withProtocol;
  }
  try {
    const parsed = new URL(cvUrl);
    return parsed.origin;
  } catch (error) {
    return 'https://freecvaudit.com';
  }
}

function buildCanonicalCvUrl(token, cvUrl, runId = '') {
  if (!token) return cvUrl;
  const base = resolveBaseUrl(cvUrl);
  const url = new URL(`/.netlify/functions/cv-email-download?token=${encodeURIComponent(token)}`, base);
  if (runId) {
    url.searchParams.set('runId', runId);
  }
  return url.toString();
}

function buildRunCvUrl(runId, cvUrl) {
  const base = resolveBaseUrl(cvUrl);
  return new URL(`/.netlify/functions/generate-pdf?runId=${encodeURIComponent(runId)}`, base).toString();
}

function createIdempotencyKey({ email, runId, isResend }) {
  return crypto
    .createHash('sha256')
    .update(`${email}|${runId}|${isResend ? 'resend' : 'first'}`)
    .digest('hex');
}

function normalizeBase64Pdf(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw) return '';
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return '';
  return raw;
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

function shouldRetryStatus(statusCode) {
  return [429, 500, 502, 503, 504].includes(statusCode);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendResendEmail(apiKey, emailPayload, idempotencyKey) {
  const maxAttempts = 3;
  let lastPayload = {};
  let lastStatus = 500;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(emailPayload),
      });
      lastStatus = response.status;
      lastPayload = await response.json().catch(() => ({}));
      if (response.ok) {
        return { ok: true, statusCode: 200, payload: lastPayload };
      }
      if (!shouldRetryStatus(response.status) || attempt === maxAttempts - 1) {
        return { ok: false, statusCode: response.status, payload: lastPayload };
      }
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        return { ok: false, statusCode: 502, payload: { error: error.message || 'Email delivery failed.' } };
      }
    }
    await sleep((attempt + 1) * 200);
  }

  return { ok: false, statusCode: lastStatus, payload: lastPayload };
}

function getHtml({ name, cvUrl, isResend, hasAttachment }) {
  const greetingName = escapeHtml(toSafeText(name, 'there'));
  const safeCvUrl = escapeHtml(toSafeText(cvUrl));
  const heading = isResend ? 'Your CV - Sent Again' : 'Your Revised CV is Ready';
  const intro = isResend
    ? 'Here is your revised CV again. You can open it anytime from any device.'
    : 'Great news — your ATS-optimized CV is ready. Open it now or save this email to access it later from any device.';
  const attachmentNote = hasAttachment
    ? '<p style="margin:16px 0 0;color:#475569;font-size:14px;">Your revised CV is also attached as a PDF for easy offline access.</p>'
    : '';

  const primaryAction = safeCvUrl
    ? `<div style="text-align:center;margin:24px 0;">
        <a href="${safeCvUrl}" style="display:inline-block;background:#2760AD;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px;">Download My CV</a>
      </div>`
    : '<p style="margin:0 0 12px;color:#334155;font-weight:600;">Your download link is temporarily unavailable. Please use the attached PDF.</p>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2760AD);padding:28px 24px;text-align:center;">
        <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;">${heading}</h1>
      </div>
      <div style="padding:28px 24px;">
        <p style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:600;">Hi ${greetingName},</p>
        <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">${intro}</p>
        ${primaryAction}
        <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px;">
          <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">This link gives you secure access to your revised CV. You can open it anytime from any device.</p>
          ${attachmentNote}
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px 24px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">FreeCVAudit.com &mdash; Free ATS-Friendly CV Audits</p>
      </div>
    </div>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  const timing = { start: Date.now() };
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log('[fulfillment][email] send-blocked reason=missing_resend_api_key');
      return json(500, { error: 'RESEND_API_KEY is missing.' });
    }

    const payload = JSON.parse(event.body || '{}');
    const email = toSafeText(payload.email).toLowerCase();
    const cvUrl = toSafeText(payload.cvUrl);
    const name = toSafeText(payload.name);
    let runId = resolveRunId(payload.runId, cvUrl);
    const isResend = Boolean(payload.resend);
    const forceSync = Boolean(payload.forceSync);
    const fulfillmentId = toSafeText(payload.fulfillmentId);
    const clientPdfBase64 = toSafeText(payload.pdfBase64);
    const clientCvText = toSafeText(payload.cvText);

    if (!email) return json(400, { error: 'email is required.' });
    if (!cvUrl) return json(400, { error: 'cvUrl is required.' });
    if (!runId) return json(400, { error: 'runId is required to create a reliable download link.' });

    // ---- Fast path: fulfillment queue already resolved all artifacts ----
    // When forceSync + pdfBase64 + artifactToken are all provided, skip redundant
    // store lookups (fulfillment, run, artifact token) since the caller already
    // validated payment, generated the CV, and created the artifact token.
    if (forceSync && clientPdfBase64 && payload.artifactToken) {
      const fastPdf = normalizeBase64Pdf(clientPdfBase64);
      const fastToken = toSafeText(payload.artifactToken);
      if (fastPdf && fastToken) {
        const fastCvUrl = buildCanonicalCvUrl(fastToken, cvUrl, runId);
        const fastSubject = isResend ? 'Here Is Your CV Again' : 'Your CV is Ready';
        const fastFrom = 'FreeCVAudit <noreply@freecvaudit.com>';
        const fastIdempotencyKey = createIdempotencyKey({ email, runId, isResend });
        const fastEmailPayload = {
          from: fastFrom,
          to: [email],
          subject: fastSubject,
          html: getHtml({ name, cvUrl: fastCvUrl, isResend, hasAttachment: true }),
          attachments: [{ filename: 'revised-cv.pdf', content: fastPdf }],
        };

        timing.sendStart = Date.now();
        console.log('[send-cv-email] fast-path-send-start', { runId, fulfillmentId, at: new Date().toISOString() });
        const fastResult = await sendResendEmail(apiKey, fastEmailPayload, fastIdempotencyKey);
        timing.sendEnd = Date.now();

        if (!fastResult.ok) {
          const fastDetails = fastResult?.payload?.message || fastResult?.payload?.error || 'Unable to send CV email.';
          timing.total = Date.now() - timing.start;
          console.warn('[send-cv-email] fast-path timing', { runId, fulfillmentId, totalMs: timing.total, outcome: 'send_failed' });
          return json(fastResult.statusCode || 502, { error: fastDetails });
        }

        // Fire-and-forget bookkeeping (same as slow path)
        const fastBookkeeping = [];
        fastBookkeeping.push(
          upsertEmailDelivery(`delivery:${fastIdempotencyKey}`, {
            runId, email, provider: 'resend',
            provider_email_id: fastResult.payload?.id || null,
            status: 'SENT', is_resend: isResend, download_url: fastCvUrl,
          }).catch((e) => {
            console.warn('Email sent but delivery record could not be persisted.', { runId, error: e?.message || e });
          })
        );
        if (fulfillmentId) {
          fastBookkeeping.push(
            updateFulfillment(fulfillmentId, (existing) => ({
              email: email || existing.email || null,
              email_status: 'SENT',
              email_sent_at: new Date().toISOString(),
            })).catch((e) => {
              console.warn('Email sent but fulfillment record could not be updated.', { fulfillmentId, error: e?.message || e });
            })
          );
        }

        timing.total = Date.now() - timing.start;
        console.log('[send-cv-email] fast-path-send-complete', {
          runId, fulfillmentId, at: new Date().toISOString(),
          sendMs: (timing.sendEnd || timing.start) - (timing.sendStart || timing.start),
          totalMs: timing.total, outcome: 'ok',
        });

        const fastWait = Promise.allSettled(fastBookkeeping);
        if (typeof event?.waitUntil === 'function') event.waitUntil(fastWait);
        else if (typeof globalThis?.waitUntil === 'function') globalThis.waitUntil(fastWait);

        return json(200, { ok: true, id: fastResult.payload?.id || null, ...(fulfillmentId ? { fulfillmentId } : {}), fastPath: true });
      }
    }

    // ---- Slow path: resolve artifacts from store ----
    if (fulfillmentId) {
      const fulfillment = await getFulfillment(fulfillmentId);
      if (!fulfillment) return json(404, { error: 'fulfillmentId was not found.' });
      if (fulfillment.payment_status !== 'PAID') {
        return json(409, { error: 'Payment is not confirmed yet. Please try again shortly.' });
      }
    }

    if (process.env.CV_EMAIL_ASYNC_MODE === 'true' && !forceSync) {
      const asyncRun = await getRun(runId).catch(() => null);
      const asyncPdfBase64 =
        normalizeBase64Pdf(clientPdfBase64) ||
        normalizeBase64Pdf(asyncRun?.final_cv_pdf_base64);
      const asyncArtifactToken =
        toSafeText(payload.artifactToken) ||
        toSafeText(asyncRun?.final_cv_artifact_token);
      const queued = await enqueueEmailJob({
        email,
        name,
        cvUrl,
        runId,
        resend: isResend,
        ...(asyncPdfBase64 ? { pdfBase64: asyncPdfBase64 } : {}),
        ...(asyncArtifactToken ? { artifactToken: asyncArtifactToken } : {}),
        ...(clientCvText ? { cvText: clientCvText } : {}),
        ...(fulfillmentId ? { fulfillmentId } : {}),
      });
      await triggerEmailQueueProcessing();
      return json(202, { ok: true, queued: true, jobId: queued.id, ...(fulfillmentId ? { fulfillmentId } : {}) });
    }

    let run = await getRun(runId);
    const rotatedRunId = toSafeText(run?.fulfillment_rotated_run_id);
    if (rotatedRunId && rotatedRunId !== runId) {
      const rotatedRun = await getRun(rotatedRunId).catch(() => null);
      const rotatedHasArtifact = Boolean(
        normalizeBase64Pdf(rotatedRun?.final_cv_pdf_base64)
        || toSafeText(rotatedRun?.final_cv_artifact_token)
      );
      if (rotatedRun && rotatedHasArtifact) {
        console.log('[send-cv-email] run-rebind', { requestedRunId: runId, effectiveRunId: rotatedRunId });
        runId = rotatedRunId;
        run = rotatedRun;
      }
    }
    const hasQualityFloorMarker = Boolean(run?.revised_cv_fallback_generated_at || run?.revised_cv_lenient_fallback_generated_at);
    const shouldEnforceQualityFloor = isQualityFloorEnabled() && !forceSync && !fulfillmentId;
    if (shouldEnforceQualityFloor && hasQualityFloorMarker) {
      console.log('[fulfillment][email] send-blocked reason=quality_floor', { runId, fulfillmentId: fulfillmentId || null, forceSync });
      return json(409, { error: 'Revised CV is still being refined for quality. Please retry shortly.' });
    }
    let snapshotPdfBase64 = normalizeBase64Pdf(clientPdfBase64) || normalizeBase64Pdf(run?.final_cv_pdf_base64);
    let artifactToken = toSafeText(payload.artifactToken) || toSafeText(run?.final_cv_artifact_token);
    let canonicalCvUrl = '';
    if (artifactToken) {
      const tokenRecord = await getArtifactToken(artifactToken);
      snapshotPdfBase64 = snapshotPdfBase64 || normalizeBase64Pdf(tokenRecord?.pdf_base64);
      if (isArtifactTokenUsable(tokenRecord)) {
        canonicalCvUrl = buildCanonicalCvUrl(artifactToken, cvUrl, runId);
      }
    }
    if (!canonicalCvUrl && snapshotPdfBase64) {
      const mintedToken = createEmailDownloadToken();
      const rawTtl = Number(process.env.CV_EMAIL_LINK_TTL_DAYS || 30);
      const ttlDays = Math.min(90, Math.max(1, Number.isFinite(rawTtl) ? rawTtl : 30));
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
      await createArtifactToken({
        token: mintedToken,
        runId,
        fulfillmentId: fulfillmentId || null,
        pdf_base64: snapshotPdfBase64,
        revised_cv_text: String(run?.revised_cv_text || '').trim() || null,
        expires_at: expiresAt,
      });
      artifactToken = mintedToken;
      canonicalCvUrl = buildCanonicalCvUrl(artifactToken, cvUrl, runId);
      if (runId) {
        await upsertRun(runId, {
          final_cv_pdf_base64: snapshotPdfBase64,
          final_cv_artifact_token: mintedToken,
          final_cv_artifact_ready_at: run?.final_cv_artifact_ready_at || new Date().toISOString(),
        }).catch(() => null);
      }
    }
    if (!snapshotPdfBase64 || !canonicalCvUrl) {
      const emergencyFetchEnabled = String(process.env.CV_EMAIL_EMERGENCY_FETCH_MODE || '').trim().toLowerCase() === 'true';
      if (emergencyFetchEnabled) {
        canonicalCvUrl = canonicalCvUrl || buildRunCvUrl(runId, cvUrl);
      } else {
        console.log('[fulfillment][email] send-blocked reason=artifact_not_ready', {
          runId,
          fulfillmentId: fulfillmentId || null,
          hasAttachment: Boolean(snapshotPdfBase64),
          hasArtifactLink: Boolean(canonicalCvUrl),
        });
        return json(425, { error: 'Final CV artifact is not ready for email delivery yet. Please retry shortly.' });
      }
    }
    console.log('[send-cv-email] artifact-ready', {
      runId,
      artifactReadyAt: run?.final_cv_artifact_ready_at || null,
      observedAt: new Date().toISOString(),
      hasAttachment: Boolean(snapshotPdfBase64),
      hasArtifactLink: Boolean(canonicalCvUrl),
    });

    const subject = isResend ? 'Here Is Your CV Again' : 'Your CV is Ready';
    const from = 'FreeCVAudit <noreply@freecvaudit.com>';
    const idempotencyKey = createIdempotencyKey({ email, runId, isResend });
    const emailPayload = {
      from,
      to: [email],
      subject,
      html: getHtml({ name, cvUrl: canonicalCvUrl, isResend, hasAttachment: Boolean(snapshotPdfBase64) }),
      ...(snapshotPdfBase64
        ? {
            attachments: [
              {
                filename: 'revised-cv.pdf',
                content: snapshotPdfBase64,
              },
            ],
          }
        : {}),
    };

    timing.sendStart = Date.now();
    console.log('[send-cv-email] send-start', { runId, at: new Date().toISOString() });
    const sendResult = await sendResendEmail(apiKey, emailPayload, idempotencyKey);
    timing.sendEnd = Date.now();
    console.log('[fulfillment][email] provider-response status=' + String(sendResult.statusCode || 500), {
      runId,
      fulfillmentId: fulfillmentId || null,
      ok: Boolean(sendResult.ok),
    });

    if (!sendResult.ok) {
      const details = sendResult?.payload?.message || sendResult?.payload?.error || 'Unable to send CV email.';
      console.warn('[send-cv-email] timing', { ...timing, total: Date.now() - timing.start, outcome: 'send_failed' });
      return json(sendResult.statusCode || 502, { error: details });
    }

    // Fire-and-forget: post-send bookkeeping should not block the response
    const bookkeepingPromises = [];
    bookkeepingPromises.push(
      upsertEmailDelivery(`delivery:${idempotencyKey}`, {
        runId,
        email,
        provider: 'resend',
        provider_email_id: sendResult.payload?.id || null,
        status: 'SENT',
        is_resend: isResend,
        download_url: canonicalCvUrl,
      }).catch((deliveryStoreError) => {
        console.warn('Email sent but delivery record could not be persisted.', {
          runId,
          error: deliveryStoreError?.message || deliveryStoreError,
        });
      })
    );
    if (fulfillmentId) {
      bookkeepingPromises.push(
        updateFulfillment(fulfillmentId, (existing) => ({
          email: email || existing.email || null,
          email_status: 'SENT',
          email_sent_at: new Date().toISOString(),
        })).catch((fulfillmentUpdateError) => {
          console.warn('Email sent but fulfillment record could not be updated.', {
            fulfillmentId,
            error: fulfillmentUpdateError?.message || fulfillmentUpdateError,
          });
        })
      );
    }


    // Log timing for observability, then return immediately
    timing.total = Date.now() - timing.start;
    console.log('[send-cv-email] send-complete', {
      runId,
      at: new Date().toISOString(),
      sendMs: (timing.sendEnd || timing.start) - (timing.sendStart || timing.start),
      totalMs: timing.total,
      outcome: 'ok',
    });

    // Wait for bookkeeping in background — Netlify Functions stay alive briefly after response
    // Use waitUntil if available (Netlify Edge-compatible), otherwise best-effort Promise.allSettled
    const waitHandle = Promise.allSettled(bookkeepingPromises);
    if (typeof event?.waitUntil === 'function') {
      event.waitUntil(waitHandle);
    } else if (typeof globalThis?.waitUntil === 'function') {
      globalThis.waitUntil(waitHandle);
    }

    return json(200, { ok: true, id: sendResult.payload?.id || null, ...(fulfillmentId ? { fulfillmentId } : {}) });
  } catch (error) {
    console.warn('[send-cv-email] timing', { totalMs: Date.now() - timing.start, outcome: 'error', error: error?.message });
    return json(500, { error: error.message || 'Unable to send CV email.' });
  }
};
