const { badRequest, parseJsonBody } = require('./http-400');
const {
  getUserById,
  getUserEntitlements,
  getUserSubscriptions,
  refreshUserEntitlements,
  upsertSubscription,
} = require('./run-store');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function resolveUserId(event, body = {}) {
  return String(getUserIdFromSessionCookie(event) || body.userId || body.user_id || '').trim();
}

function normalizePlan(value) {
  const safePlan = String(value || '').trim().toLowerCase();
  if (safePlan === 'team') return 'team';
  if (safePlan === 'pro') return 'pro';
  return 'free';
}

function normalizeStatus(value) {
  const safeStatus = String(value || 'ACTIVE').trim().toUpperCase();
  if (safeStatus === 'CANCELED' || safeStatus === 'PAST_DUE' || safeStatus === 'ACTIVE') return safeStatus;
  return 'ACTIVE';
}

exports.handler = async (event) => {
  const functionName = 'subscription';
  const route = '/.netlify/functions/subscription';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod === 'GET') {
    const userId = resolveUserId(event);
    if (!userId) return json(401, { error: 'No active user session.' });

    const user = await getUserById(userId);
    if (!user) return json(404, { error: 'User not found.' });

    const subscriptions = await getUserSubscriptions(userId);
    const entitlements = (await getUserEntitlements(userId)) || (await refreshUserEntitlements(userId));
    return json(200, { ok: true, userId, subscriptions, entitlements });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body || {};

  const sessionUserId = String(getUserIdFromSessionCookie(event) || '').trim();
  const requestedUserId = String(body.userId || body.user_id || '').trim();
  if (!sessionUserId && !requestedUserId) {
    return json(401, { error: 'No active user session.' });
  }
  if (sessionUserId && requestedUserId && sessionUserId !== requestedUserId) {
    return json(403, { error: 'Session user does not match requested user.' });
  }
  const userId = sessionUserId || requestedUserId;
  if (!userId) {
    return badRequest({
      event,
      functionName,
      route,
      message: 'Missing userId.',
      payload: body,
      missingFields: ['userId'],
    });
  }

  const user = await getUserById(userId);
  if (!user) {
    return json(404, { error: 'User not found.' });
  }

  const plan = normalizePlan(body.plan);
  const status = normalizeStatus(body.status);
  const provider = String(body.provider || 'internal').trim().toLowerCase();
  const billingCycle = String(body.billingCycle || body.billing_cycle || '').trim().toLowerCase();
  const promoCode = String(body.promoCode || body.promo_code || '').trim().toUpperCase();
  const winbackChoice = String(body.winbackChoice || body.winback_choice || '').trim().toLowerCase();

  const subscription = await upsertSubscription({
    subscription_id: String(body.subscriptionId || body.subscription_id || '').trim() || undefined,
    user_id: userId,
    plan,
    status,
    provider,
    last_successful_payment_at: body.lastSuccessfulPaymentAt || body.last_successful_payment_at || null,
    next_renewal_at: body.nextRenewalAt || body.next_renewal_at || null,
    current_period_end: body.currentPeriodEnd || body.current_period_end || null,
    billing_cycle: billingCycle || null,
    promo_code: promoCode || null,
    winback_choice: winbackChoice || null,
  });

  const entitlements = await refreshUserEntitlements(userId);
  return json(200, { ok: true, userId, subscription, entitlements });
};
