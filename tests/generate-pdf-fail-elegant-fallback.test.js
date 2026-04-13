const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function decodePdfFromResponse(response) {
  return Buffer.from(response.body, 'base64').toString('latin1');
}

async function run() {
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.STRICT_STYLE_MODE = 'true';

  const pdfBuilderPath = require.resolve('../netlify/functions/pdf-builder');
  delete require.cache[pdfBuilderPath];
  const realPdfBuilder = require('../netlify/functions/pdf-builder');
  let lenientCalled = false;

  require.cache[pdfBuilderPath].exports = {
    ...realPdfBuilder,
    buildPdfBufferFromStructuredCv: () => {
      throw new Error('CV export validation failed: simulated structured render failure.');
    },
    buildPdfBuffer: () => {
      throw new Error('CV export validation failed: simulated canonical render failure.');
    },
    buildPdfBufferLenient: (text) => {
      lenientCalled = true;
      return realPdfBuilder.buildPdfBufferLenient(text);
    },
  };

  clearModule('../netlify/functions/generate-pdf');
  const handler = require('../netlify/functions/generate-pdf').handler;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cvText: [
        'Strategic transformation leader with 20+ years improving capability outcomes across regions.',
        'Additional sentence that should never become the candidate name.',
        'EXECUTIVE SUMMARY',
        'Improved leadership pipeline and strategic planning outcomes.',
        'SELECTED ACHIEVEMENTS',
        '- Led enterprise talent strategy.',
      ].join('\n'),
      cvAnalysis: 'Improve formatting',
    }),
  });

  assert.strictEqual(response.statusCode, 200, 'A safe fallback PDF should be returned even when strict stages fail.');
  assert.strictEqual(response.headers['Content-Type'], 'application/pdf');
  assert.ok(lenientCalled, 'Lenient safe render should be used as final stage.');
  const pdfContent = decodePdfFromResponse(response);
  assert.ok(pdfContent.includes('(PROFESSIONAL SUMMARY) Tj'), 'Fallback output should preserve section structure.');
  assert.ok(!pdfContent.includes('/F2 16 Tf\n(Strategic transformation leader with 20+ years'), 'Polluted identity content must not render as candidate name.');
  assert.ok(!pdfContent.includes('EXECUTIVE SUMMARY:'), 'Heading labels should not be duplicated in body content.');

  delete process.env.STRICT_STYLE_MODE;
  console.log('Generate PDF fail-elegant fallback test passed');
}

run().catch((error) => {
  delete process.env.STRICT_STYLE_MODE;
  console.error(error);
  process.exitCode = 1;
});

