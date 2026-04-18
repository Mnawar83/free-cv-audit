const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64_PDF_REGEX = /^[A-Za-z0-9+/=_-]+$/;

function isValidEmail(value) {
  return EMAIL_REGEX.test(String(value || '').trim());
}

function isValidUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (_error) {
    return false;
  }
}

function normalizeBase64Pdf(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw) return '';
  if (!BASE64_PDF_REGEX.test(raw)) return '';
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return padded;
}

module.exports = {
  isValidEmail,
  isValidUrl,
  normalizeBase64Pdf,
};
