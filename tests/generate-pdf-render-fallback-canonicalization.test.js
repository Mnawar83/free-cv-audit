const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  delete process.env.GOOGLE_AI_API_KEY;

  const pdfBuilderPath = require.resolve('../netlify/functions/pdf-builder');
  delete require.cache[pdfBuilderPath];
  const realPdfBuilder = require('../netlify/functions/pdf-builder');
  let canonicalizeCallCount = 0;
  require.cache[pdfBuilderPath].exports = {
    ...realPdfBuilder,
    normalizeToCvTemplateText: (text) => {
      canonicalizeCallCount += 1;
      if (canonicalizeCallCount === 2) {
        throw new Error('CV export validation failed: simulated fallback canonicalization failure.');
      }
      return `${realPdfBuilder.normalizeToCvTemplateText(text)}\nCANONICALIZED_MARKER`;
    },
    buildPdfBuffer: (text) => {
      if (String(text).includes('CANONICALIZED_MARKER')) {
        throw new Error('CV export validation failed: simulated primary render validation failure.');
      }
      return realPdfBuilder.buildPdfBuffer(text);
    },
  };

  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cvText: 'Jane Example\nPROFESSIONAL EXPERIENCE\n- Led implementation improvements across teams',
      cvAnalysis: 'Improve ATS readability',
    }),
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['Content-Type'], 'application/pdf');
  assert.ok(response.body.length > 0);
  assert.ok(canonicalizeCallCount >= 2, 'Expected canonicalization to be attempted in both primary and fallback paths.');

  console.log('Generate PDF render fallback canonicalization test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
