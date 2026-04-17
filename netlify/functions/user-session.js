const { badRequest, parseJsonBody } = require('./http-400');
const { getUserById, upsertUserByEmail } = require('./run-store');
const {
  createUserSessionCookie,
  clearUserSessionCookie,
  getUserIdFromSessionCookie,
  hasUserSessionSecretConfigured,
} = require('./user-session-auth');

function json(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeName(value) {
  return String(value || '').trim().slice(0, 120);
}

exports.handler = async (event) => {
  const functionName = 'user-session';
  const route = '/.netlify/functions/user-session';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod === 'GET') {
    const userId = getUserIdFromSessionCookie(event);
    if (!userId) return json(401, { error: 'No active user session.' });
    const user = await getUserById(userId);
    if (!user) return json(401, { error: 'User session is invalid.' });
    return json(200, { ok: true, user: { userId: user.user_id, email: user.email, name: user.name || '' } });
  }

  if (event.httpMethod === 'DELETE') {
    return json(200, { ok: true }, { 'Set-Cookie': clearUserSessionCookie() });
  }

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

  const user = await upsertUserByEmail(email, { name: normalizeName(body.name) || undefined });
  const expiresAt = new Date(Date.now() + (1000 * 60 * 60 * 24 * 30)).toISOString();
  const cookie = createUserSessionCookie({ userId: user.user_id, expiresAt });

  return json(
    200,
    { ok: true, user: { userId: user.user_id, email: user.email, name: user.name || '' } },
    { 'Set-Cookie': cookie },
  );
};
