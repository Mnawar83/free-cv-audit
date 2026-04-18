const assert = require('assert');
const fs = require('fs');

const headers = fs.readFileSync('_headers', 'utf8');
assert.ok(headers.includes('Content-Security-Policy'));
assert.ok(headers.includes("default-src 'self'"));
console.log('csp-headers.test.js passed');
