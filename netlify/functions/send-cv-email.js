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

function getHtml({ name, cvUrl, isResend }) {
  const greetingName = toSafeText(name, 'there');
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
        <a href="${cvUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">Open My CV</a>
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
    const isResend = Boolean(payload.resend);

    if (!email) return json(400, { error: 'email is required.' });
    if (!cvUrl) return json(400, { error: 'cvUrl is required.' });

    const subject = isResend ? 'Here Is Your CV Again' : 'Your CV is Ready';
    const from = 'FreeCVAudit <noreply@freecvaudit.com>';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html: getHtml({ name, cvUrl, isResend }),
      }),
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
