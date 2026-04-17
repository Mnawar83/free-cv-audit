const crypto = require('crypto');
const { refreshUserEntitlements, upsertSubscription } = require('./run-store');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function verifySharedSecret(event) {
  const expected = String(process.env.WHISHPAY_WEBHOOK_SHARED_SECRET || '').trim();
  if (!expected) return true;
  const provided = String(event?.headers?.['x-webhook-secret'] || event?.headers?.['X-Webhook-Secret'] || '').trim();
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

function mapStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'CANCELED' || status === 'CANCELLED') return 'CANCELED';
  if (status === 'PAST_DUE' || status === 'FAILED') return 'PAST_DUE';
  return 'ACTIVE';
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!verifySharedSecret(event)) return json(401, { error: 'Invalid webhook secret.' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const subscriptionId = String(payload.subscriptionId || payload.externalId || payload.id || '').trim();
    const userId = String(payload.userId || payload.metadata?.user_id || '').trim();
    const plan = String(payload.plan || payload.metadata?.plan || 'pro').trim().toLowerCase();
    const status = mapStatus(payload.status || payload.eventType || payload.event_type);
    if (!subscriptionId || !userId) return json(400, { error: 'Missing subscriptionId or userId.' });

    const subscription = await upsertSubscription({
      subscription_id: subscriptionId,
      user_id: userId,
      provider: 'whishpay',
      plan,
      status,
      current_period_end: payload.currentPeriodEnd || payload.current_period_end || null,
    });
    const entitlements = await refreshUserEntitlements(userId);
    return json(200, { ok: true, subscription, entitlements });
  } catch (error) {
    return json(500, { error: error?.message || 'WhishPay subscription webhook failed.' });
  }
};
