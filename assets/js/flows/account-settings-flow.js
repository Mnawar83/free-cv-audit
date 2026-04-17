(function initAccountSettingsFlowModule(global) {
  const ns = global.AppFlows = global.AppFlows || {};

  function toCheckoutPrompt(plan) {
    const safePlan = String(plan || '').trim().toUpperCase();
    return `Sign in to continue with ${safePlan} checkout.`;
  }

  ns.accountSettings = {
    toCheckoutPrompt,
  };
})(window);
