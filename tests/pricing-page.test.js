const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
  const pagePath = path.join(__dirname, '..', 'pricing.html');
  const html = fs.readFileSync(pagePath, 'utf8');

  assert.ok(html.includes('id="pro"'));
  assert.ok(html.includes('id="pricing-billing-cycle"'));
  assert.ok(html.includes('id="pricing-promo-code"'));
  assert.ok(html.includes('id="pricing-apply-promo"'));
  assert.ok(html.includes("const pricingExperimentKey = 'pricing_experiment_variant_v1';"));
  assert.ok(html.includes('function resolveExperimentVariant() {'));
  assert.ok(html.includes("monthly_default"));
  assert.ok(html.includes("annual_default"));
  assert.ok(html.includes('/.netlify/functions/subscription-checkout?'));
  assert.ok(html.includes('billingCycle'));
  assert.ok(html.includes('promo'));
  assert.ok(html.includes('exp'));

  console.log('pricing page test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
