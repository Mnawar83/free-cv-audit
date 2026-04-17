(function initLandingFlowModule(global) {
  const ns = global.AppFlows = global.AppFlows || {};

  function isAccountRoute(hashValue) {
    return String(hashValue || '').trim().toLowerCase() === '#account';
  }

  function applySurfaceRouteState({ accountMode, acquisitionFunnelCard, accountRouteSection, mainCard, shouldScroll = false, uploadSection }) {
    if (acquisitionFunnelCard) acquisitionFunnelCard.classList.toggle('hidden', accountMode);
    if (accountRouteSection) accountRouteSection.classList.toggle('hidden', !accountMode);
    if (mainCard) mainCard.classList.toggle('hidden', accountMode);
    if (accountMode && shouldScroll && accountRouteSection) {
      accountRouteSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!accountMode && shouldScroll && uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  ns.landing = {
    isAccountRoute,
    applySurfaceRouteState,
  };
})(window);
