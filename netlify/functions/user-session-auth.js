const crypto = require('crypto');

const USER_COOKIE_NAME = '__Host-cv_user_session';

function getSessionSecret() {
  return String(process.env.USER_SESSION_SECRET || '').trim();
}

function hasUserSessionSecretConfigured() {
  return Boolean(getSessionSecret());
}

function toBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function sign(value) {
  const secret = getSessionSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookies(headerValue) {
  const output = {};
  const raw = String(headerValue || '');
  raw.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return;
    output[key] = rest.join('=');
  });
  return output;
}

function createUserSessionCookie({ userId, expiresAt }) {
  const safeUserId = String(userId || '').trim();
  const safeExpiresAt = String(expiresAt || '').trim();
  if (!safeUserId || !safeExpiresAt) return '';
  const payload = JSON.stringify({ userId: safeUserId, expiresAt: safeExpiresAt });
  const encoded = toBase64Url(payload);
  const signature = sign(encoded);
  if (!signature) return '';

  const expiresAtMs = new Date(safeExpiresAt).getTime();
  const maxAgeSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : 0;
  return `${USER_COOKIE_NAME}=${encoded}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearUserSessionCookie() {
  return `${USER_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getUserIdFromSessionCookie(event) {
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || '');
  const raw = String(cookies[USER_COOKIE_NAME] || '');
  if (!raw.includes('.')) return '';
  const [encoded, providedSig] = raw.split('.', 2);
  const expectedSig = sign(encoded);
  if (!expectedSig || !providedSig || expectedSig.length !== providedSig.length) return '';
  if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'utf8'), Buffer.from(providedSig, 'utf8'))) {
    return '';
  }

  try {
    const payload = JSON.parse(fromBase64Url(encoded));
    const userId = String(payload?.userId || '').trim();
    const expiresAtMs = new Date(String(payload?.expiresAt || '')).getTime();
    if (!userId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return '';
    return userId;
  } catch (_error) {
    return '';
  }
}

module.exports = {
  USER_COOKIE_NAME,
  hasUserSessionSecretConfigured,
  createUserSessionCookie,
  clearUserSessionCookie,
  getUserIdFromSessionCookie,
};
