const crypto = require('crypto');

const COOKIE_NAME_PREFIX = '__Host-cv_fulfillment_session';
const LEGACY_COOKIE_NAME_PREFIX = '__Host-cv_fulfillment_session_';

function getSessionSecret() {
  return String(process.env.FULFILLMENT_SESSION_SECRET || '').trim();
}

function hasSessionSecretConfigured() {
  return Boolean(getSessionSecret());
}

function assertSessionSecretConfigured() {
  if (hasSessionSecretConfigured()) return;
  throw new Error('FULFILLMENT_SESSION_SECRET is required for fulfillment session cookies.');
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

function getLegacyFulfillmentCookieClearValues(event, maxCount = 12) {
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || '');
  const legacyNames = Object.keys(cookies || {})
    .filter((name) => String(name || '').startsWith(LEGACY_COOKIE_NAME_PREFIX))
    .slice(0, Math.max(0, Number(maxCount) || 0));
  return legacyNames.map((cookieName) => `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function getSetCookieValues(event, primaryCookie = '') {
  const output = [];
  const safePrimaryCookie = String(primaryCookie || '').trim();
  if (safePrimaryCookie) output.push(safePrimaryCookie);
  output.push(...getLegacyFulfillmentCookieClearValues(event));
  return output;
}

function getAllowedOrigins() {
  const known = [
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    'https://freecvaudit.com',
    'https://www.freecvaudit.com',
    'http://localhost:8888',
    'http://127.0.0.1:8888',
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const normalized = known
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin.toLowerCase();
  } catch (error) {
    return '';
  }
}

function validateCsrfOrigin(event) {
  const origin = normalizeOrigin(event?.headers?.origin || event?.headers?.Origin || '');
  if (!origin) return 'origin header is required.';
  const allowed = getAllowedOrigins();
  return allowed.includes(origin) ? '' : 'origin is not allowed.';
}

function getCookieNameForFulfillment(fulfillmentId) {
  const safeFulfillmentId = String(fulfillmentId || '').trim();
  if (!safeFulfillmentId) return '';
  // Keep a single cookie key so repeat purchases do not accumulate unbounded cookie headers.
  // The fulfillment id is still embedded and validated from the signed payload.
  return COOKIE_NAME_PREFIX;
}

function createFulfillmentSessionCookie({ fulfillmentId, accessToken, expiresAt }) {
  const safeFulfillmentId = String(fulfillmentId || '').trim();
  const safeAccessToken = String(accessToken || '').trim();
  const safeExpiresAt = String(expiresAt || '').trim();
  if (!safeFulfillmentId || !safeAccessToken || !safeExpiresAt) return '';
  const cookieName = getCookieNameForFulfillment(safeFulfillmentId);
  if (!cookieName) return '';
  const payload = JSON.stringify({
    fulfillmentId: safeFulfillmentId,
    accessToken: safeAccessToken,
    expiresAt: safeExpiresAt,
  });
  const encoded = toBase64Url(payload);
  const signature = sign(encoded);
  if (!signature) return '';
  const expiresAtMs = new Date(safeExpiresAt).getTime();
  const maxAgeSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : 0;
  return `${cookieName}=${encoded}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearFulfillmentSessionCookie(fulfillmentId) {
  const cookieName = getCookieNameForFulfillment(fulfillmentId);
  if (!cookieName) return '';
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getAccessTokenFromSessionCookie(event, expectedFulfillmentId = '') {
  const cookieName = getCookieNameForFulfillment(expectedFulfillmentId);
  if (!cookieName) return '';
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || '');
  const raw = String(cookies[cookieName] || '');
  if (!raw.includes('.')) return '';
  const [encoded, providedSig] = raw.split('.', 2);
  const expectedSig = sign(encoded);
  if (!expectedSig || !providedSig || expectedSig.length !== providedSig.length) return '';
  if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'utf8'), Buffer.from(providedSig, 'utf8'))) {
    return '';
  }

  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(encoded));
  } catch (error) {
    return '';
  }
  const fulfillmentId = String(payload?.fulfillmentId || '').trim();
  const accessToken = String(payload?.accessToken || '').trim();
  const expiresAtRaw = String(payload?.expiresAt || '').trim();
  const expectedId = String(expectedFulfillmentId || '').trim();
  if (!fulfillmentId || !accessToken || !expiresAtRaw) return '';
  if (expectedId && expectedId !== fulfillmentId) return '';
  const expiresAtMs = new Date(expiresAtRaw).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return '';
  return accessToken;
}

module.exports = {
  COOKIE_NAME_PREFIX,
  LEGACY_COOKIE_NAME_PREFIX,
  assertSessionSecretConfigured,
  clearFulfillmentSessionCookie,
  createFulfillmentSessionCookie,
  getLegacyFulfillmentCookieClearValues,
  getCookieNameForFulfillment,
  getSetCookieValues,
  getAccessTokenFromSessionCookie,
  hasSessionSecretConfigured,
  validateCsrfOrigin,
};
