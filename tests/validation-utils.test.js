const assert = require('assert');
const { isValidEmail, isValidUrl, normalizeBase64Pdf } = require('../netlify/functions/utils/validation');

assert.strictEqual(isValidEmail('user@example.com'), true);
assert.strictEqual(isValidEmail('bad-email'), false);
assert.strictEqual(isValidUrl('https://freecvaudit.com'), true);
assert.strictEqual(isValidUrl('ftp://example.com'), false);
assert.strictEqual(normalizeBase64Pdf('SGVsbG8='), 'SGVsbG8=');
assert.strictEqual(normalizeBase64Pdf('SGVsbG8_'), 'SGVsbG8/');
assert.strictEqual(normalizeBase64Pdf('%%%'), '');
console.log('validation-utils.test.js passed');
