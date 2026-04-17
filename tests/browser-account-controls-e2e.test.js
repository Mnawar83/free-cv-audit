const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.ok(html.includes("const planUpgradeProButton = document.getElementById('plan-upgrade-pro-button');"));
  assert.ok(html.includes("const planUpgradeTeamButton = document.getElementById('plan-upgrade-team-button');"));
  assert.ok(html.includes('async function beginPlanCheckout(plan) {'));
  assert.ok(html.includes('/.netlify/functions/subscription-checkout?plan='));

  assert.ok(html.includes('data-workspace-role'));
  assert.ok(html.includes('data-workspace-status'));
  assert.ok(html.includes('data-workspace-update'));
  assert.ok(html.includes("method: 'PATCH'"));

  assert.ok(html.includes("trackEvent('account_subscription_updated'"));
  assert.ok(html.includes("trackEvent('workspace_member_updated'"));
  assert.ok(html.includes("trackEvent('workspace_member_removed'"));
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
  assert.ok(html.includes('id="funnel-team-cta-button"'));
  assert.ok(html.includes('id="funnel-open-account-button"'));
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
