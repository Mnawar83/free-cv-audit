const { createEmailDownloadToken, getRun } = require('./run-store');
const { saveEmailDownloadSnapshot } = require('./email-download-store');

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

function buildCanonicalCvUrl(token, cvUrl) {
  if (!token) return cvUrl;
  const base = resolveBaseUrl(cvUrl);
  return new URL(`/.netlify/functions/cv-email-download?token=${encodeURIComponent(token)}`, base).toString();
}

function getHtml({ name, cvUrl, isResend }) {
  const greetingName = escapeHtml(toSafeText(name, 'there'));
  const safeCvUrl = escapeHtml(toSafeText(cvUrl));
  const heading = 'Your CV is ready';
  const intro = isResend
    ? 'Here is your CV again. You can open it anytime from any device.'
    : 'Your revised CV is ready. Open it now or save this email to access it later.';

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;">
        <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">${heading}</h1>
        <p style="margin:0 0 16px;color:#334155;">Hi ${greetingName},</p>
        <p style="margin:0 0 24px;color:#334155;">${intro}</p>
        <a href="${safeCvUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">Open My CV</a>
        <p style="margin:20px 0 0;color:#475569;">You can access this CV anytime from any device.</p>
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

    if (!email) return json(400, { error: 'email is required.' });
    if (!cvUrl) return json(400, { error: 'cvUrl is required.' });
    if (!runId) return json(400, { error: 'runId is required to create a reliable download link.' });

    const run = await getRun(runId);
    if (!run?.revised_cv_text) {
      return json(404, { error: 'Your revised CV is no longer available. Please generate a new one.' });
    }
    const token = createEmailDownloadToken();
    const rawTtl = Number(process.env.CV_EMAIL_LINK_TTL_DAYS || 30);
    const ttlDays = Math.min(90, Math.max(1, Number.isFinite(rawTtl) ? rawTtl : 30));
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    await saveEmailDownloadSnapshot(event, token, {
      runId,
      revised_cv_text: run.revised_cv_text,
      expires_at: expiresAt,
    });
    const canonicalCvUrl = buildCanonicalCvUrl(token, cvUrl);

    const subject = isResend ? 'Here Is Your CV Again' : 'Your CV is Ready';
    const from = 'FreeCVAudit <noreply@freecvaudit.com>';
    const emailPayload = {
      from,
      to: [email],
      subject,
      html: getHtml({ name, cvUrl: canonicalCvUrl, isResend }),
    };
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const payloadResponse = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = payloadResponse?.message || payloadResponse?.error || 'Unable to send CV email.';
      return json(502, { error: details });
    }

    return json(200, { ok: true, id: payloadResponse?.id || null });
  } catch (error) {
    return json(500, { error: error.message || 'Unable to send CV email.' });
  }
};
