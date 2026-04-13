const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.ok(
    html.includes('Browser-side final CV generation is disabled. Final CV is generated post-payment and delivered by email.'),
    'Legacy browser-side final generation should be explicitly disabled.',
  );

  const regenerateBlockMatch = html.match(/function regeneratePdfOnRestore\(\) \{([\s\S]*?)\n        \}/);
  assert.ok(regenerateBlockMatch, 'regeneratePdfOnRestore should exist.');
  assert.ok(
    !regenerateBlockMatch[1].includes('generateRevisedPdf('),
    'Paid restore path should not trigger browser-side final generation.',
  );

  assert.ok(
    html.includes('Final CV will be emailed'),
    'Paid flow messaging should communicate email-based delivery.',
  );

  console.log('browser paid flow guard test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
