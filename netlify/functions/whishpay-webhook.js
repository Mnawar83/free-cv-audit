const crypto = require('crypto');
const {
  enqueueFulfillmentJob,
  getFulfillmentByProviderOrderId,
  markPaymentEventProcessed,
  updateFulfillment,
} = require('./run-store');
const { triggerFulfillmentQueueProcessing } = require('./queue-trigger');

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
  const providedSecret = String(event.headers?.['x-webhook-secret'] || event.headers?.['X-Webhook-Secret'] || '').trim();
  if (providedSecret) {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(providedSecret);
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }
  const timestamp = String(event.headers?.['x-webhook-timestamp'] || event.headers?.['X-Webhook-Timestamp'] || '').trim();
  const signature = String(event.headers?.['x-webhook-signature'] || event.headers?.['X-Webhook-Signature'] || '').trim();
  if (!timestamp || !signature) return false;
  const timestampMs = Number(timestamp);
  const maxAgeMs = Math.max(10_000, Number(process.env.WEBHOOK_SIGNATURE_MAX_AGE_MS || 5 * 60 * 1000));
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > maxAgeMs) return false;
  const body = String(event.body || '');
  const expectedSignature = crypto
    .createHmac('sha256', expected)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expectedSignature);
  const providedBuf = Buffer.from(signature);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function resolveProviderOrderId(payload) {
  return String(payload?.externalId || payload?.orderId || payload?.id || '').trim();
}

function isPaidStatus(payload) {
  const status = String(payload?.collectStatus || payload?.status || '').toUpperCase();
  return ['SUCCESS', 'PAID', 'COLLECTED'].includes(status) || payload?.isPaidStatus === true;
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    if (!verifySharedSecret(event)) {
      return json(401, { error: 'Invalid webhook secret.' });
    }
    const payload = JSON.parse(event.body || '{}');
    const eventId = String(payload.eventId || payload.id || '').trim();
    if (!eventId) return json(400, { error: 'Webhook event id is required.' });

    const dedupe = await markPaymentEventProcessed('whishpay-webhook', eventId, String(payload?.status || ''));
    if (dedupe?.duplicate) {
      console.info('[payment-confirmation] whishpay webhook duplicate event observed; continuing to ensure fulfillment queueing.', { eventId });
    }

    const orderId = resolveProviderOrderId(payload);
    if (!orderId) {
      return json(200, { ok: true, ignored: true, reason: 'ORDER_ID_NOT_PRESENT' });
    }

    const fulfillment = await getFulfillmentByProviderOrderId('whishpay', orderId);
    if (!fulfillment) {
      return json(200, { ok: true, ignored: true, reason: 'FULFILLMENT_NOT_FOUND', orderId });
    }

    const paid = isPaidStatus(payload);
    if (paid) {
      const deliveryEmail = String(fulfillment.email || '').trim().toLowerCase();
      await updateFulfillment(fulfillment.fulfillment_id, {
        payment_status: 'PAID',
        email: deliveryEmail || null,
        provider_capture_id: String(payload?.transactionId || payload?.id || fulfillment.provider_capture_id || ''),
        paid_at: fulfillment.paid_at || new Date().toISOString(),
      });
      if (deliveryEmail) {
        console.log('[payment-confirmation] whishpay webhook confirmed; queueing paid fulfillment', {
          fulfillmentId: fulfillment.fulfillment_id,
        });
        await updateFulfillment(fulfillment.fulfillment_id, {
          processing_status: 'full_audit_queued',
        });
        await enqueueFulfillmentJob({
          fulfillmentId: fulfillment.fulfillment_id,
          email: deliveryEmail,
          name: '',
          forceSync: true,
        });
        await triggerFulfillmentQueueProcessing();
      }
    }

    return json(200, { ok: true, fulfillmentId: fulfillment.fulfillment_id, paid, orderId });
  } catch (error) {
    return json(500, { error: error.message || 'WhishPay webhook processing failed.' });
  }
};
