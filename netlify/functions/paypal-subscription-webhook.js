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
  const expected = String(process.env.PAYPAL_WEBHOOK_SHARED_SECRET || '').trim();
  if (!expected) return true;
  const provided = String(event?.headers?.['x-webhook-secret'] || event?.headers?.['X-Webhook-Secret'] || '').trim();
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

function mapStatus(eventType, fallback = 'ACTIVE') {
  const type = String(eventType || '').trim().toUpperCase();
  if (type.includes('CANCEL')) return 'CANCELED';
  if (type.includes('PAST_DUE') || type.includes('SUSPEND') || type.includes('FAILED')) return 'PAST_DUE';
  if (type.includes('ACTIV') || type.includes('RENEW')) return 'ACTIVE';
  return String(fallback || 'ACTIVE').trim().toUpperCase();
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!verifySharedSecret(event)) return json(401, { error: 'Invalid webhook secret.' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const eventType = String(payload.event_type || '').trim();
    const resource = payload.resource || {};
    const subscriptionId = String(resource.id || payload.id || '').trim();
    const userId = String(resource.custom_id || resource?.custom?.user_id || payload.userId || '').trim();
    const plan = String(resource.plan_id || payload.plan || 'pro').trim().toLowerCase();
    if (!subscriptionId || !userId) return json(400, { error: 'Missing subscriptionId or userId.' });

    const subscription = await upsertSubscription({
      subscription_id: subscriptionId,
      user_id: userId,
      provider: 'paypal',
      plan,
      status: mapStatus(eventType, resource.status),
      current_period_end: resource.billing_info?.next_billing_time || null,
      next_renewal_at: resource.billing_info?.next_billing_time || null,
      last_successful_payment_at:
        resource.billing_info?.last_payment?.time
        || resource.billing_info?.last_payment?.date
        || null,
    });
    const entitlements = await refreshUserEntitlements(userId);
    return json(200, { ok: true, subscription, entitlements });
  } catch (error) {
    return json(500, { error: error?.message || 'PayPal subscription webhook failed.' });
  }
};
