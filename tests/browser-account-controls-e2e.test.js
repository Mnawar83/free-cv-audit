const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.ok(html.includes("const planUpgradeProButton = document.getElementById('plan-upgrade-pro-button');"));
  assert.ok(html.includes("const accountPromoCodeInput = document.getElementById('account-promo-code-input');"));
  assert.ok(html.includes("const accountOpenPricingButton = document.getElementById('account-open-pricing-button');"));
  assert.ok(html.includes("const winbackCard = document.getElementById('winback-card');"));
  assert.ok(html.includes("const winbackPauseButton = document.getElementById('winback-pause-button');"));
  assert.ok(html.includes("const winbackDiscountButton = document.getElementById('winback-discount-button');"));
  assert.ok(html.includes("const winbackDowngradeButton = document.getElementById('winback-downgrade-button');"));
  assert.ok(html.includes('id="winback-cancel-anyway-button"'));
  assert.ok(html.includes("const accountRetentionLoopCard = document.getElementById('account-retention-loop-card');"));
  assert.ok(html.includes("const retentionSendWeeklyEmailButton = document.getElementById('retention-send-weekly-email-button');"));
  assert.ok(html.includes("const retentionEmailStatus = document.getElementById('retention-email-status');"));
  assert.ok(html.includes('async function beginPlanCheckout(plan, options = {}) {'));
  assert.ok(html.includes('/.netlify/functions/subscription-checkout?${query.toString()}'));
  assert.ok(html.includes('function openPricingPage(preferredPlan = \'pro\') {'));
  assert.ok(html.includes('pricing_experiment_variant_v1'));
  assert.ok(html.includes('function applyWinbackPause() {'));
  assert.ok(html.includes('function applyWinbackDiscount() {'));
  assert.ok(html.includes('function applyWinbackDowngrade() {'));
  assert.ok(html.includes('function renderRetentionLoops(retention = {}) {'));
  assert.ok(html.includes("async function sendWeeklyRetentionEmail() {"));
  assert.ok(html.includes('/.netlify/functions/retention-email'));

  assert.ok(html.includes("trackEvent('account_subscription_updated'"));
  assert.ok(html.includes("const accountDashboardRefreshButton = document.getElementById('account-dashboard-refresh-button');"));
  assert.ok(html.includes("const accountDashboardExportJsonButton = document.getElementById('account-dashboard-export-json-button');"));
  assert.ok(html.includes("const accountDashboardExportCsvButton = document.getElementById('account-dashboard-export-csv-button');"));
  assert.ok(html.includes("const accountDashboardSubscriptionsFilter = document.getElementById('account-dashboard-subscriptions-filter');"));
  assert.ok(html.includes("const accountDashboardRunsFilter = document.getElementById('account-dashboard-runs-filter');"));
  assert.ok(html.includes('async function refreshAccountDashboard() {'));
  assert.ok(html.includes("async function exportAccountActivity(format = 'json') {"));
  assert.ok(html.includes('/.netlify/functions/account-dashboard'));
  assert.ok(html.includes('/.netlify/functions/account-activity-export?format='));
  assert.ok(html.includes("trackEvent('account_dashboard_refreshed'"));
  assert.ok(html.includes("trackEvent('account_activity_exported'"));
  assert.ok(html.includes('id="acquisition-funnel-card"'));
  assert.ok(html.includes('id="funnel-start-audit-button"'));
  assert.ok(html.includes('id="funnel-free-cta-button"'));
  assert.ok(html.includes('id="funnel-pro-cta-button"'));
  assert.ok(html.includes('id="funnel-open-account-button"'));
  assert.ok(html.includes('id="onboarding-step-badge-uploaded"'));
  assert.ok(html.includes('id="onboarding-step-badge-reviewed"'));
  assert.ok(html.includes('id="onboarding-step-badge-optimized"'));
  assert.ok(html.includes('id="onboarding-continue-card"'));
  assert.ok(html.includes('id="onboarding-continue-button"'));
  assert.ok(html.includes('id="onboarding-tooltip-box"'));
  assert.ok(html.includes('id="onboarding-funnel-tooltip"'));
  assert.ok(html.includes("const ONBOARDING_STORAGE_KEY = 'onboarding_state_v1';"));
  assert.ok(html.includes('function loadOnboardingState() {'));
  assert.ok(html.includes('function setOnboardingStep(step) {'));
  assert.ok(html.includes('function renderOnboardingState() {'));
  assert.ok(html.includes('function completeFirstSessionTooltip() {'));
  assert.ok(html.includes("setOnboardingStep('uploaded');"));
  assert.ok(html.includes("setOnboardingStep('reviewed');"));
  assert.ok(html.includes("setOnboardingStep('optimized');"));
  assert.ok(html.includes('Continue where you left off'));
  assert.ok(html.includes('id="account-route-section" class="hidden'));
  assert.ok(html.includes("function isAccountRoute() {"));
  assert.ok(html.includes("function applySurfaceRoute(options = {}) {"));
  assert.ok(html.includes('async function handleFunnelPlanSelection(plan) {'));
  assert.ok(html.includes("window.location.hash = 'account';"));
  assert.ok(html.includes('What happens after payment?'));
  assert.ok(html.includes('~30s:'));
  assert.ok(html.includes('~2m:'));
  assert.ok(html.includes('Refund/guarantee:'));
  assert.ok(html.includes('<p class="text-[11px] font-semibold text-slate-200">FAQ</p>'));

  console.log('browser account controls e2e test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
