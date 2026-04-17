const { getUserIdFromSessionCookie } = require('./user-session-auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function requireRunOwnerSession(event, run, options = {}) {
  const runOwnerId = String(run?.user_id || '').trim();
  if (!runOwnerId) {
    if (options.allowAnonymousRun !== false) return { ok: true };
    return { ok: false, response: json(401, { error: 'Authentication is required for this run.' }) };
  }

  const sessionUserId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!sessionUserId) {
    return { ok: false, response: json(401, { error: 'You must sign in to access this run.' }) };
  }
  if (sessionUserId !== runOwnerId) {
    return { ok: false, response: json(403, { error: 'You are not authorized to access this run.' }) };
  }
  return { ok: true, userId: sessionUserId };
}

module.exports = {
  requireRunOwnerSession,
};
