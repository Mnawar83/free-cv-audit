const { takeRateLimitSlot } = require('./run-store');

function normalizeOrigin(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(withScheme).origin.toLowerCase();
  } catch (_error) {
    return '';
  }
}

function getAllowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || process.env.URL || 'https://freecvaudit.com');
  return configured
    .split(',')
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
}

function validateCsrfOrigin(event = {}) {
  const method = String(event.httpMethod || '').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;
  const origin = normalizeOrigin(event?.headers?.origin || event?.headers?.Origin || '');
  if (!origin) return null;
  const allowed = getAllowedOrigins();
  if (!allowed.length) return 'allowed origins are not configured';
  if (!allowed.includes(origin)) return `origin not allowed (${origin})`;
  return null;
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

async function enforceRateLimit(event, { keyPrefix, windowMsEnv, maxEnv, defaults }) {
  const windowMs = Math.max(1_000, Number(process.env[windowMsEnv] || defaults.windowMs));
  const maxRequests = Math.max(1, Number(process.env[maxEnv] || defaults.max));
  const key = `${keyPrefix}:${getClientIp(event)}`;
  const result = await takeRateLimitSlot(key, windowMs, maxRequests);
  return Boolean(result?.limited);
}

module.exports = {
  validateCsrfOrigin,
  enforceRateLimit,
};
