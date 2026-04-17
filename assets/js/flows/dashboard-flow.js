(function initDashboardFlowModule(global) {
  const ns = global.AppFlows = global.AppFlows || {};

  function buildDashboardQuery({ subOffset = 0, subLimit = 5, subStatus = 'ALL', runOffset = 0, runLimit = 5, runStatus = 'ALL' }) {
    return new URLSearchParams({
      subOffset: String(subOffset),
      subLimit: String(subLimit),
      subStatus: String(subStatus || 'ALL').trim().toUpperCase(),
      runOffset: String(runOffset),
      runLimit: String(runLimit),
      runStatus: String(runStatus || 'ALL').trim().toUpperCase(),
    });
  }

  function summarizeDashboard({ plan = 'FREE', subCount = 0, runCount = 0, workspaceMembers = 0, lastPayment = '', renewal = '' }) {
    const renewalText = renewal ? ` · Next renewal ${new Date(renewal).toLocaleDateString()}` : '';
    const paymentText = lastPayment ? ` · Last payment ${new Date(lastPayment).toLocaleDateString()}` : '';
    return `Plan ${plan} · ${subCount} subscriptions in view · ${runCount} runs in view · ${workspaceMembers} workspace members${paymentText}${renewalText}`;
  }

  ns.dashboard = {
    buildDashboardQuery,
    summarizeDashboard,
  };
})(window);
