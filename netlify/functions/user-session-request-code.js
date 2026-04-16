const { badRequest, parseJsonBody } = require('./http-400');
const { saveUserSessionCode, takeRateLimitSlot } = require('./run-store');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function createCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getClientIp(event) {
  return String(
    event?.headers?.['x-nf-client-connection-ip']
    || event?.headers?.['x-forwarded-for']
    || event?.headers?.['X-Forwarded-For']
    || event?.requestContext?.identity?.sourceIp
    || 'unknown'
  ).split(',')[0].trim();
}

exports.handler = async (event) => {
  const functionName = 'user-session-request-code';
  const route = '/.netlify/functions/user-session-request-code';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body || {};

  const email = String(body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return badRequest({
      event,
      functionName,
      route,
      message: 'A valid email is required.',
      payload: body,
      missingFields: ['email'],
      invalidFields: ['email'],
    });
  }

  const clientKey = `user-session-code:${getClientIp(event)}:${email}`;
  const slot = await takeRateLimitSlot(
    clientKey,
    Math.max(1_000, Number(process.env.USER_SESSION_CODE_RATE_LIMIT_WINDOW_MS || 60_000)),
    Math.max(1, Number(process.env.USER_SESSION_CODE_RATE_LIMIT_MAX || 5)),
  );
  if (slot?.limited) return json(429, { error: 'Too many verification code requests. Please wait before retrying.' });

  const code = createCode();
  const ttlMs = Math.max(60_000, Number(process.env.USER_SESSION_CODE_TTL_MS || 10 * 60 * 1000));
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await saveUserSessionCode(email, code, expiresAt, { requested_at: new Date().toISOString() });

  const debugMode = String(process.env.USER_SESSION_RETURN_DEBUG_CODE || '').trim().toLowerCase() === 'true';
  return json(200, {
    ok: true,
    message: 'Verification code issued.',
    expiresAt,
    ...(debugMode ? { debugCode: code } : {}),
  });
};
