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

function getOrderId(payload) {
  return (
    payload?.resource?.supplementary_data?.related_ids?.order_id ||
    payload?.resource?.invoice_id ||
    payload?.resource?.id ||
    ''
  );
}

function getCaptureStatus(payload) {
  return String(payload?.resource?.status || payload?.summary || '').toUpperCase();
}

function verifySharedSecret(event) {
  const expected = String(process.env.PAYPAL_WEBHOOK_SHARED_SECRET || '').trim();
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
    const eventId = String(payload.id || '').trim();
    const eventType = String(payload.event_type || '').trim();
    if (!eventId) return json(400, { error: 'Webhook event id is required.' });

    const dedupe = await markPaymentEventProcessed('paypal-webhook', eventId, eventType);
    if (dedupe?.duplicate) {
      return json(200, { ok: true, duplicate: true });
    }

    const orderId = String(getOrderId(payload)).trim();
    if (!orderId) {
      return json(200, { ok: true, ignored: true, reason: 'ORDER_ID_NOT_PRESENT' });
    }
    const fulfillment = await getFulfillmentByProviderOrderId('paypal', orderId);
    if (!fulfillment) {
      return json(200, { ok: true, ignored: true, reason: 'FULFILLMENT_NOT_FOUND', orderId });
    }

    const status = getCaptureStatus(payload);
    const isPaid = ['COMPLETED', 'CAPTURED', 'SUCCESS'].includes(status) || eventType.includes('PAYMENT.CAPTURE.COMPLETED');
    if (isPaid) {
      const deliveryEmail = String(fulfillment.email || '').trim().toLowerCase();
      await updateFulfillment(fulfillment.fulfillment_id, {
        payment_status: 'PAID',
        email: deliveryEmail || null,
        provider_capture_id: String(payload?.resource?.id || fulfillment.provider_capture_id || ''),
        paid_at: fulfillment.paid_at || new Date().toISOString(),
      });
      if (deliveryEmail) {
        await enqueueFulfillmentJob({
          fulfillmentId: fulfillment.fulfillment_id,
          email: deliveryEmail,
          name: '',
          forceSync: true,
        });
        await triggerFulfillmentQueueProcessing();
      }
    }

    return json(200, { ok: true, fulfillmentId: fulfillment.fulfillment_id, orderId, isPaid });
  } catch (error) {
    return json(500, { error: error.message || 'PayPal webhook processing failed.' });
  }
};
