const { getUserEntitlements } = require('./run-store');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function normalizePlan(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'team') return 'team';
  if (safe === 'pro') return 'pro';
  return '';
}

function normalizeBillingCycle(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'annual') return 'annual';
  return 'monthly';
}

function normalizeExperiment(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'annual_default' || safe === 'monthly_default') return safe;
  return 'monthly_default';
}

function appendQueryParam(url, key, value) {
  const safeValue = String(value || '').trim();
  if (!safeValue) return url;
  if (String(url).includes(`${key}=`)) return url;
  const hasQuery = String(url).includes('?');
  return `${url}${hasQuery ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(safeValue)}`;
}

function resolveConfiguredUrl(plan) {
  const planSpecific = plan === 'team'
    ? String(process.env.SUBSCRIPTION_TEAM_CHECKOUT_URL || '').trim()
    : String(process.env.SUBSCRIPTION_PRO_CHECKOUT_URL || '').trim();
  if (planSpecific) return planSpecific;
  return String(process.env.SUBSCRIPTION_CHECKOUT_URL_TEMPLATE || '').trim();
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) return json(401, { error: 'No active user session.' });

  const plan = normalizePlan(event.queryStringParameters?.plan);
  if (!plan) return json(400, { error: 'Unsupported plan.', supportedPlans: ['pro', 'team'] });
  const billingCycle = normalizeBillingCycle(event.queryStringParameters?.billingCycle || process.env.SUBSCRIPTION_DEFAULT_BILLING_CYCLE);
  const experiment = normalizeExperiment(event.queryStringParameters?.exp || process.env.SUBSCRIPTION_EXPERIMENT_DEFAULT);
  const promoCode = String(event.queryStringParameters?.promo || '').trim().toUpperCase();

  const template = resolveConfiguredUrl(plan);
  if (!template) {
    return json(404, {
      error: 'Checkout is not configured for this plan.',
      code: 'CHECKOUT_NOT_CONFIGURED',
      plan,
    });
  }

  const returnUrl = String(event.queryStringParameters?.returnUrl || process.env.URL || '').trim();
  const entitlements = await getUserEntitlements(userId);
  let checkoutUrl = template
    .replaceAll('{USER_ID}', encodeURIComponent(userId))
    .replaceAll('{PLAN}', encodeURIComponent(plan))
    .replaceAll('{RETURN_URL}', encodeURIComponent(returnUrl))
    .replaceAll('{BILLING_CYCLE}', encodeURIComponent(billingCycle))
    .replaceAll('{PROMO_CODE}', encodeURIComponent(promoCode))
    .replaceAll('{EXPERIMENT}', encodeURIComponent(experiment));
  checkoutUrl = appendQueryParam(checkoutUrl, 'billingCycle', billingCycle);
  checkoutUrl = appendQueryParam(checkoutUrl, 'exp', experiment);
  if (promoCode) checkoutUrl = appendQueryParam(checkoutUrl, 'promo', promoCode);

  return json(200, {
    ok: true,
    userId,
    plan,
    currentPlan: String(entitlements?.plan || 'free').trim().toLowerCase(),
    billingCycle,
    experiment,
    promoCode: promoCode || null,
    checkoutUrl,
  });
};
