const crypto = require('crypto');
const {
  computeFulfillmentAccessTokenExpiresAt,
  createFulfillmentAccessToken,
  getFulfillment,
  hashFulfillmentAccessToken,
  takeRateLimitSlot,
  updateFulfillment,
} = require('./run-store');
const {
  assertSessionSecretConfigured,
  createFulfillmentSessionCookie,
  validateCsrfOrigin,
} = require('./fulfillment-auth');

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  };
}

function hashLinkCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
}

function createLinkCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function shouldReturnDebugCode() {
  return String(process.env.FULFILLMENT_LINK_RETURN_DEBUG_CODE || '').trim().toLowerCase() === 'true';
}

async function sendLinkCodeEmail({ email, code }) {
  const shouldSend = String(process.env.FULFILLMENT_LINK_SEND_CODE || 'true').trim().toLowerCase() !== 'false';
  if (!shouldSend) return { ok: true };
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY is required to deliver link codes.' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'FreeCVAudit <noreply@freecvaudit.com>',
      to: [email],
      subject: 'Your FreeCVAudit session verification code',
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
    }),
  });
  if (!response.ok) {
    const details = await response.text();
    return { ok: false, error: details || 'Unable to deliver verification code.' };
  }
  return { ok: true };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    assertSessionSecretConfigured();
    const csrfError = validateCsrfOrigin(event);
    if (csrfError) {
      return json(403, { error: `csrf validation failed: ${csrfError}` });
    }

    const payload = JSON.parse(event.body || '{}');
    const fulfillmentId = String(payload.fulfillmentId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const code = String(payload.code || '').trim();
    if (!fulfillmentId) return json(400, { error: 'fulfillmentId is required.' });
    if (!email) return json(400, { error: 'email is required.' });

    const forwarded = String(event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0].trim();
    const windowMs = Math.max(1_000, Number(process.env.FULFILLMENT_LINK_RATE_LIMIT_WINDOW_MS || 60_000));
    const maxRequests = Math.max(1, Number(process.env.FULFILLMENT_LINK_RATE_LIMIT_MAX || 5));
    const slot = await takeRateLimitSlot(`${forwarded || 'unknown-ip'}:fulfillment-link:${fulfillmentId}`, windowMs, maxRequests);
    if (slot?.limited) {
      return json(429, { error: 'Too many session-link attempts. Please wait before trying again.' });
    }

    const fulfillment = await getFulfillment(fulfillmentId);
    if (!fulfillment) return json(404, { error: 'fulfillment was not found.' });
    if (String(fulfillment.email || '').trim().toLowerCase() !== email) {
      return json(403, { error: 'email does not match this fulfillment.' });
    }
    if (String(fulfillment.payment_status || '').toUpperCase() !== 'PAID') {
      return json(409, { error: 'Payment is not confirmed yet for this fulfillment.' });
    }

    if (!code) {
      const generatedCode = createLinkCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await updateFulfillment(fulfillmentId, {
        link_code_hash: hashLinkCode(generatedCode),
        link_code_expires_at: expiresAt,
        link_code_attempts: 0,
        link_code_last_requested_at: new Date().toISOString(),
      });
      const sent = await sendLinkCodeEmail({ email, code: generatedCode });
      if (!sent.ok) {
        return json(502, { error: sent.error || 'Unable to deliver verification code.' });
      }
      return json(200, {
        ok: true,
        challengeSent: true,
        fulfillmentId,
        ...(shouldReturnDebugCode() ? { debugCode: generatedCode } : {}),
      });
    }

    const expectedHash = String(fulfillment.link_code_hash || '').trim();
    const expiresAtMs = fulfillment.link_code_expires_at ? new Date(fulfillment.link_code_expires_at).getTime() : NaN;
    const attempts = Number(fulfillment.link_code_attempts || 0);
    const maxAttempts = Math.max(1, Number(process.env.FULFILLMENT_LINK_CODE_MAX_ATTEMPTS || 5));
    if (!expectedHash || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return json(409, { error: 'Verification code has expired. Request a new code.' });
    }
    if (attempts >= maxAttempts) {
      return json(429, { error: 'Too many invalid verification attempts. Request a new code.' });
    }

    const actualHash = hashLinkCode(code);
    const hashesMatch =
      actualHash.length === expectedHash.length &&
      crypto.timingSafeEqual(Buffer.from(actualHash, 'utf8'), Buffer.from(expectedHash, 'utf8'));
    if (!hashesMatch) {
      await updateFulfillment(fulfillmentId, {
        link_code_attempts: attempts + 1,
      });
      return json(403, { error: 'Verification code is invalid.' });
    }

    const rotatedAccessToken = createFulfillmentAccessToken();
    const rotatedExpiresAt = computeFulfillmentAccessTokenExpiresAt();
    await updateFulfillment(fulfillmentId, {
      access_token: null,
      access_token_hash: hashFulfillmentAccessToken(rotatedAccessToken),
      access_token_expires_at: rotatedExpiresAt,
      last_session_linked_at: new Date().toISOString(),
      link_code_hash: null,
      link_code_expires_at: null,
      link_code_attempts: 0,
    });
    const setCookie = createFulfillmentSessionCookie({
      fulfillmentId,
      accessToken: rotatedAccessToken,
      expiresAt: rotatedExpiresAt,
    });
    return json(200, { ok: true, fulfillmentId }, setCookie ? { 'Set-Cookie': setCookie } : {});
  } catch (error) {
    return json(500, { error: error.message || 'Unable to link fulfillment session.' });
  }
};
