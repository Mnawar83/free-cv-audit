const { createEmailDownloadToken, enqueueEmailJob, getRun, upsertEmailDelivery } = require('./run-store');
const { saveEmailDownloadSnapshot } = require('./email-download-store');
const { buildPdfBuffer } = require('./pdf-builder');
const crypto = require('crypto');

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

async function fetchPdfBase64FromUrl(cvUrl) {
  try {
    const response = await fetch(cvUrl, { method: 'GET' });
    if (!response.ok) return '';
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.includes('application/pdf')) return '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return '';
    return buffer.toString('base64');
  } catch (error) {
    return '';
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
  const heading = 'Your CV is ready';
  const intro = isResend
    ? 'Here is your CV again. You can open it anytime from any device.'
    : 'Your revised CV is ready. Open it now or save this email to access it later.';
  const attachmentNote = hasAttachment
    ? '<p style="margin:16px 0 0;color:#334155;">Your revised CV is also attached as a PDF for backup access.</p>'
    : '';

  const primaryAction = safeCvUrl
    ? `<a href="${safeCvUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">Open My CV</a>`
    : '<p style="margin:0 0 12px;color:#334155;font-weight:600;">Your download link is temporarily unavailable. Please use the attached PDF.</p>';

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;">
        <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">${heading}</h1>
        <p style="margin:0 0 16px;color:#334155;">Hi ${greetingName},</p>
        <p style="margin:0 0 24px;color:#334155;">${intro}</p>
        ${primaryAction}
        <p style="margin:20px 0 0;color:#475569;">You can access this CV anytime from any device.</p>
        ${attachmentNote}
        <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;">FreeCVAudit.com</p>
      </div>
    </div>
  `;
}

exports.handler = async (event) => {
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
    const runId = resolveRunId(payload.runId, cvUrl);
    const isResend = Boolean(payload.resend);
    const forceSync = Boolean(payload.forceSync);

    if (!email) return json(400, { error: 'email is required.' });
    if (!cvUrl) return json(400, { error: 'cvUrl is required.' });
    if (!runId) return json(400, { error: 'runId is required to create a reliable download link.' });

    if (process.env.CV_EMAIL_ASYNC_MODE === 'true' && !forceSync) {
      const queued = await enqueueEmailJob({
        email,
        name,
        cvUrl,
        runId,
        resend: isResend,
      });
      return json(202, { ok: true, queued: true, jobId: queued.id });
    }

    const run = await getRun(runId);
    const revisedCvText = String(run?.revised_cv_text || '');
    if (!revisedCvText) {
      console.warn('Run is missing revised CV text; sending email with runId download URL only.', { runId });
    }
    let snapshotPdfBase64 = '';
    try {
      if (revisedCvText) {
        snapshotPdfBase64 = buildPdfBuffer(revisedCvText).toString('base64');
      }
    } catch (attachmentError) {
      console.warn('Unable to build CV PDF snapshot from revised text.', attachmentError?.message || attachmentError);
    }
    let canonicalCvUrl = '';
    if (!snapshotPdfBase64) {
      const resolvedCvUrl = buildRunCvUrl(runId, cvUrl);
      snapshotPdfBase64 = await fetchPdfBase64FromUrl(resolvedCvUrl);
      if (!snapshotPdfBase64) {
        console.warn('Unable to fetch CV PDF for email snapshot.', { runId });
      }
    }
    if (!revisedCvText && !snapshotPdfBase64) {
      return json(404, { error: 'Your revised CV is no longer available. Please regenerate it and try again.' });
    }
    if (revisedCvText || snapshotPdfBase64) {
      const token = createEmailDownloadToken();
      const rawTtl = Number(process.env.CV_EMAIL_LINK_TTL_DAYS || 30);
      const ttlDays = Math.min(90, Math.max(1, Number.isFinite(rawTtl) ? rawTtl : 30));
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
      try {
        await saveEmailDownloadSnapshot(event, token, {
          runId,
          ...(snapshotPdfBase64 ? { pdf_base64: snapshotPdfBase64 } : {}),
          ...(revisedCvText ? { revised_cv_text: revisedCvText } : {}),
          expires_at: expiresAt,
        });
        canonicalCvUrl = buildCanonicalCvUrl(token, cvUrl);
      } catch (snapshotError) {
        console.warn('Unable to persist email download snapshot; falling back to runId URL.', snapshotError?.message || snapshotError);
      }
    }

    const subject = isResend ? 'Here Is Your CV Again' : 'Your CV is Ready';
    const from = 'FreeCVAudit <noreply@freecvaudit.com>';
    const idempotencyKey = createIdempotencyKey({ email, runId, isResend });
    const emailPayload = {
      from,
      to: [email],
      subject,
      html: getHtml({ name, cvUrl: canonicalCvUrl, isResend, hasAttachment: false }),
    };
    const sendResult = await sendResendEmail(apiKey, emailPayload, idempotencyKey);
    if (!sendResult.ok) {
      const details = sendResult?.payload?.message || sendResult?.payload?.error || 'Unable to send CV email.';
      return json(sendResult.statusCode || 502, { error: details });
    }

    try {
      await upsertEmailDelivery(`delivery:${idempotencyKey}`, {
        runId,
        email,
        provider: 'resend',
        provider_email_id: sendResult.payload?.id || null,
        status: 'SENT',
        is_resend: isResend,
        download_url: canonicalCvUrl,
      });
    } catch (deliveryStoreError) {
      console.warn('Email sent but delivery record could not be persisted.', {
        runId,
        error: deliveryStoreError?.message || deliveryStoreError,
      });
    }
    return json(200, { ok: true, id: sendResult.payload?.id || null });
  } catch (error) {
    return json(500, { error: error.message || 'Unable to send CV email.' });
  }
};
