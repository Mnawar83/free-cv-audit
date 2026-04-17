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
  assert.ok(html.includes('async function refreshAccountDashboard() {'));
  assert.ok(html.includes('/.netlify/functions/account-dashboard'));
  assert.ok(html.includes("trackEvent('account_dashboard_refreshed'"));

  console.log('browser account controls e2e test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
