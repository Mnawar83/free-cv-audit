(function initWorkspaceFlowModule(global) {
  const ns = global.AppFlows = global.AppFlows || {};

  function normalizeWorkspaceRole(roleValue) {
    return String(roleValue || 'member').trim().toLowerCase() === 'admin' ? 'admin' : 'member';
  }

  function normalizeWorkspaceStatus(statusValue) {
    const safe = String(statusValue || 'INVITED').trim().toUpperCase();
    if (safe === 'ACTIVE' || safe === 'SUSPENDED') return safe;
    return 'INVITED';
  }

  ns.workspace = {
    normalizeWorkspaceRole,
    normalizeWorkspaceStatus,
  };
})(window);
