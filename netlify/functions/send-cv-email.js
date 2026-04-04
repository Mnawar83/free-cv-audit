const { getRun } = require('./run-store');
const { buildPdfBuffer } = require('./pdf-builder');

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

function createPdfAttachment(pdfBuffer) {
  if (!pdfBuffer) return null;
  return {
    filename: 'revised-cv.pdf',
    content: pdfBuffer.toString('base64'),
    content_type: 'application/pdf',
  };
}

function getHtml({ name, cvUrl, isResend, hasAttachment }) {
  const greetingName = escapeHtml(toSafeText(name, 'there'));
  const safeCvUrl = escapeHtml(toSafeText(cvUrl));
  const heading = 'Your CV is ready';
  const intro = isResend
    ? 'Here is your CV again. You can open it anytime from any device.'
    : 'Your revised CV is ready. Open it now or save this email to access it later.';
  const attachmentNote = hasAttachment
    ? '<p style="margin:20px 0 0;color:#475569;">Your revised CV is also attached to this email as a PDF.</p>'
    : '';

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;">
        <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">${heading}</h1>
        <p style="margin:0 0 16px;color:#334155;">Hi ${greetingName},</p>
        <p style="margin:0 0 24px;color:#334155;">${intro}</p>
        <a href="${safeCvUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">Open My CV</a>
        ${attachmentNote}
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

    let attachments;
    if (runId) {
      try {
        const run = await getRun(runId);
        if (run?.revised_cv_text) {
          const pdfBuffer = buildPdfBuffer(run.revised_cv_text);
          const attachment = createPdfAttachment(pdfBuffer);
          if (attachment) attachments = [attachment];
        }
      } catch (attachError) {
        console.warn('Unable to attach PDF to email; sending link only.', attachError?.message || attachError);
      }
    }

    const subject = isResend ? 'Here Is Your CV Again' : 'Your CV is Ready';
    const from = 'FreeCVAudit <noreply@freecvaudit.com>';
    const emailPayload = {
      from,
      to: [email],
      subject,
      html: getHtml({ name, cvUrl, isResend, hasAttachment: Boolean(attachments) }),
    };
    if (attachments) {
      emailPayload.attachments = attachments;
    }
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
