const assert = require('assert');
process.env.ALLOWED_ORIGINS = 'https://freecvaudit.com';
const { validateCsrfOrigin } = require('../netlify/functions/request-guards');

assert.strictEqual(validateCsrfOrigin({ httpMethod: 'GET', headers: {} }), null);
assert.strictEqual(validateCsrfOrigin({ httpMethod: 'POST', headers: {} }), null);
assert.strictEqual(validateCsrfOrigin({ httpMethod: 'POST', headers: { origin: 'https://freecvaudit.com' } }), null);
assert.ok(String(validateCsrfOrigin({ httpMethod: 'POST', headers: { origin: 'https://evil.com' } })).includes('origin not allowed'));
console.log('request-guards.test.js passed');
