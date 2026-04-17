const crypto = require('crypto');
const { parseJsonBody } = require('./http-400');
const { refreshUserEntitlements, upsertSubscription } = require('./run-store');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function verifyWebhookSecret(event) {
  const expected = String(process.env.SUBSCRIPTION_WEBHOOK_SECRET || '').trim();
  if (!expected) return true;
  const provided = String(event?.headers?.['x-webhook-secret'] || event?.headers?.['X-Webhook-Secret'] || '').trim();
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

function mapStatusFromEvent(eventType, fallbackStatus = 'ACTIVE') {
  const safeType = String(eventType || '').trim().toLowerCase();
  if (safeType.includes('canceled') || safeType.includes('cancelled')) return 'CANCELED';
  if (safeType.includes('past_due') || safeType.includes('past-due')) return 'PAST_DUE';
  if (safeType.includes('renewed') || safeType.includes('activated') || safeType.includes('created')) return 'ACTIVE';
  return String(fallbackStatus || 'ACTIVE').trim().toUpperCase();
}

exports.handler = async (event) => {
  const functionName = 'subscription-webhook';
  const route = '/.netlify/functions/subscription-webhook';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!verifyWebhookSecret(event)) {
    return json(401, { error: 'Invalid webhook secret.' });
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body || {};

  const userId = String(body.userId || body.user_id || '').trim();
  const subscriptionId = String(body.subscriptionId || body.subscription_id || '').trim();
  if (!userId || !subscriptionId) {
    return json(400, { error: 'Missing userId or subscriptionId.' });
  }

  const plan = String(body.plan || 'free').trim().toLowerCase();
  const provider = String(body.provider || 'webhook').trim().toLowerCase();
  const eventType = String(body.eventType || body.event_type || '').trim();
  const status = mapStatusFromEvent(eventType, body.status);

  const subscription = await upsertSubscription({
    subscription_id: subscriptionId,
    user_id: userId,
    plan,
    provider,
    status,
    billing_cycle_anchor: body.billingCycleAnchor || body.billing_cycle_anchor || null,
    current_period_end: body.currentPeriodEnd || body.current_period_end || null,
    canceled_at: status === 'CANCELED' ? new Date().toISOString() : null,
  });

  const entitlements = await refreshUserEntitlements(userId);
  return json(200, { ok: true, subscription, entitlements });
};
