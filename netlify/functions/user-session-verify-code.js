const { badRequest, parseJsonBody } = require('./http-400');
const { consumeUserSessionCode, upsertUserByEmail } = require('./run-store');
const { createUserSessionCookie, hasUserSessionSecretConfigured } = require('./user-session-auth');
const { isValidEmail, isValidUrl, normalizeBase64Pdf } = require('./utils/validation');

function json(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  const functionName = 'user-session-verify-code';
  const route = '/.netlify/functions/user-session-verify-code';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasUserSessionSecretConfigured()) {
    return json(500, { error: 'USER_SESSION_SECRET is not configured.' });
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body || {};

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!isValidEmail(email) || !code) {
    return badRequest({
      event,
      functionName,
      route,
      message: 'Valid email and verification code are required.',
      payload: body,
      missingFields: ['email', 'code'],
      invalidFields: ['email', 'code'],
    });
  }

  const result = await consumeUserSessionCode(email, code);
  if (!result?.ok) {
    return json(401, { error: 'Verification code is invalid or expired.', reason: result?.reason || 'INVALID_CODE' });
  }

  const user = await upsertUserByEmail(email, {});
  const expiresAt = new Date(Date.now() + (1000 * 60 * 60 * 24 * 30)).toISOString();
  const cookie = createUserSessionCookie({ userId: user.user_id, expiresAt });

  return json(200, { ok: true, user: { userId: user.user_id, email: user.email } }, { 'Set-Cookie': cookie });
};
