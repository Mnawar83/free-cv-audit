const {
  createEmailDownloadToken,
  createArtifactToken,
  enqueueEmailJob,
  getFulfillment,
  getRun,
  updateFulfillment,
  upsertEmailDelivery,
} = require('./run-store');
const { saveEmailDownloadSnapshot } = require('./email-download-store');
const { buildPdfBuffer, buildPdfBufferFromStructuredCv, normalizeToCvTemplateText } = require('./pdf-builder');
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

function canonicalizeCvText(text) {
  const safeText = toSafeText(text);
  if (!safeText) return '';
  try {
    return normalizeToCvTemplateText(safeText);
  } catch (error) {
    console.warn('Unable to normalize CV text; using source text for PDF generation.', error?.message || error);
    return safeText;
  }
}

async function fetchPdfBase64FromUrl(cvUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(process.env.CV_EMAIL_SNAPSHOT_FETCH_TIMEOUT_MS || 8000)));
  try {
    const response = await fetch(cvUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok) return '';
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.includes('application/pdf')) return '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return '';
    return buffer.toString('base64');
  } catch (error) {
    return '';
  } finally {
    clearTimeout(timeout);
  }
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

    // Parallelize fulfillment validation + run fetch when both are needed
    if (fulfillmentId) {
      const fulfillment = await getFulfillment(fulfillmentId);
      if (!fulfillment) return json(404, { error: 'fulfillmentId was not found.' });
      if (fulfillment.payment_status !== 'PAID') {
        return json(409, { error: 'Payment is not confirmed yet. Please try again shortly.' });
      }
    }

    if (process.env.CV_EMAIL_ASYNC_MODE === 'true' && !forceSync) {
      const queued = await enqueueEmailJob({
        email,
        name,
        cvUrl,
        runId,
        resend: isResend,
        ...(fulfillmentId ? { fulfillmentId } : {}),
      });
      await triggerEmailQueueProcessing();
      return json(202, { ok: true, queued: true, jobId: queued.id, ...(fulfillmentId ? { fulfillmentId } : {}) });
    }

    timing.buildStart = Date.now();

    let run = await getRun(runId);
    if ((!run?.revised_cv_text || run?.revised_cv_fallback_generated_at || run?.revised_cv_lenient_fallback_generated_at) && run?.original_cv_text) {
      try {
        const generatePdfHandler = require('./generate-pdf').handler;
        const refreshResponse = await generatePdfHandler({
          httpMethod: 'POST',
          body: JSON.stringify({
            runId,
            cvText: run.original_cv_text,
            cvAnalysis: run.audit_result || '',
            forceRegenerate: true,
          }),
        });
        const refreshedRunId = toSafeText(
          refreshResponse?.headers?.['x-run-id'] || refreshResponse?.headers?.['X-Run-Id'],
        );
        if (refreshedRunId) {
          runId = refreshedRunId;
        }
        run = await getRun(runId);
      } catch (refreshError) {
        console.warn('Unable to refresh fallback revised CV before sending email.', {
          runId,
          error: refreshError?.message || refreshError,
        });
      }
    }
    if (isQualityFloorEnabled() && (run?.revised_cv_fallback_generated_at || run?.revised_cv_lenient_fallback_generated_at)) {
      return json(409, { error: 'Revised CV is still being refined for quality. Please retry shortly.' });
    }
    const revisedCvText = run?.revised_cv_text ? canonicalizeCvText(run.revised_cv_text) : '';
    if (!revisedCvText) {
      console.warn('Run is missing revised CV text; attempting to resolve final attachment from generated PDF.', { runId });
    }
    let snapshotPdfBase64 = '';
    try {
      if (run?.revised_cv_structured) {
        snapshotPdfBase64 = buildPdfBufferFromStructuredCv(run.revised_cv_structured).toString('base64');
      } else if (revisedCvText) {
        snapshotPdfBase64 = buildPdfBuffer(revisedCvText).toString('base64');
      }
    } catch (attachmentError) {
      console.warn('Unable to build CV PDF snapshot from revised source.', attachmentError?.message || attachmentError);
    }
    let canonicalCvUrl = '';
    if (!snapshotPdfBase64 && clientPdfBase64) {
      snapshotPdfBase64 = clientPdfBase64;
    }
    if (!snapshotPdfBase64) {
      const resolvedCvUrl = buildRunCvUrl(runId, cvUrl);
      snapshotPdfBase64 = await fetchPdfBase64FromUrl(resolvedCvUrl);
      if (!snapshotPdfBase64) {
        console.warn('Unable to fetch CV PDF for email snapshot.', { runId });
      }
    }

    const effectiveRevisedText = revisedCvText;
    if (!snapshotPdfBase64) {
      return json(409, { error: 'Final CV attachment is not ready yet. Please retry shortly.' });
    }

    if ((effectiveRevisedText || snapshotPdfBase64) && !canonicalCvUrl) {
      const token = createEmailDownloadToken();
      const rawTtl = Number(process.env.CV_EMAIL_LINK_TTL_DAYS || 30);
      const ttlDays = Math.min(90, Math.max(1, Number.isFinite(rawTtl) ? rawTtl : 30));
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const snapshotData = {
        runId,
        ...(snapshotPdfBase64 ? { pdf_base64: snapshotPdfBase64 } : {}),
        ...(effectiveRevisedText ? { revised_cv_text: effectiveRevisedText } : {}),
        expires_at: expiresAt,
      };
      try {
        // Parallelize artifact token creation and blob snapshot write
        await Promise.all([
          createArtifactToken({
            token,
            fulfillmentId: fulfillmentId || null,
            ...snapshotData,
          }),
          saveEmailDownloadSnapshot(event, token, snapshotData),
        ]);
        canonicalCvUrl = buildCanonicalCvUrl(token, cvUrl, runId);
      } catch (snapshotError) {
        console.warn('Unable to persist email download snapshot; falling back to runId URL.', snapshotError?.message || snapshotError);
        if (runId) {
          canonicalCvUrl = buildRunCvUrl(runId, cvUrl);
        }
      }
    }

    timing.buildEnd = Date.now();

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
    const sendResult = await sendResendEmail(apiKey, emailPayload, idempotencyKey);
    timing.sendEnd = Date.now();

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
    console.log('[send-cv-email] timing', {
      buildMs: (timing.buildEnd || timing.start) - (timing.buildStart || timing.start),
      sendMs: (timing.sendEnd || timing.start) - (timing.sendStart || timing.start),
      totalMs: timing.total,
      hasAttachment: Boolean(snapshotPdfBase64),
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
