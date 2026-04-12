const assert = require('assert');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.CONTEXT = 'production';
  delete process.env.CV_STRICT_STYLE_MODE;

  const pdfBuilderPath = require.resolve('../netlify/functions/pdf-builder');
  delete require.cache[pdfBuilderPath];
  const realPdfBuilder = require('../netlify/functions/pdf-builder');
  let lenientCalled = false;

  require.cache[pdfBuilderPath].exports = {
    ...realPdfBuilder,
    buildPdfBuffer: () => {
      throw new Error('CV export validation failed: simulated strict builder failure.');
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
      cvText: 'Page 1 of 1\nProfessional Title\nJane Example\n- Led delivery',
      cvAnalysis: 'Improve formatting',
    }),
  });

  assert.strictEqual(response.statusCode, 500);
  const payload = JSON.parse(response.body);
  assert.ok(
    String(payload.error || '').includes('strict style mode blocked lenient fallback rendering'),
    'Expected strict style mode to block lenient fallback.',
  );
  assert.strictEqual(lenientCalled, false, 'Lenient fallback should not be used in strict style mode.');

  delete process.env.CONTEXT;
  console.log('Generate PDF strict style mode test passed');
}

run().catch((error) => {
  delete process.env.CONTEXT;
  console.error(error);
  process.exitCode = 1;
});
