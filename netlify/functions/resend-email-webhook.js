const { findEmailDeliveryByProviderId, isWebhookEventProcessed, markWebhookEventProcessed, upsertEmailDelivery } = require('./run-store');
const crypto = require('crypto');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function normalizeStatus(eventType) {
  const value = String(eventType || '').toLowerCase();
  if (value.includes('delivered')) return 'DELIVERED';
  if (value.includes('bounced')) return 'BOUNCED';
  if (value.includes('complained')) return 'COMPLAINED';
  if (value.includes('failed')) return 'FAILED';
  if (value.includes('opened')) return 'OPENED';
  return 'UPDATED';
}

function isValidHmacSignature(secret, rawBody, signatureHeader) {
  const header = String(signatureHeader || '').trim();
  if (!header) return false;
  const provided = header.replace(/^sha256=/i, '');
  if (!provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(rawBody || ''), 'utf8').digest('hex');
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function parseWebhookTimestamp(event) {
  const raw =
    event.headers?.['x-resend-timestamp'] ||
    event.headers?.['X-Resend-Timestamp'] ||
    event.headers?.['x-webhook-timestamp'] ||
    event.headers?.['X-Webhook-Timestamp'] ||
    '';
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshTimestamp(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return false;
  const toleranceMs = Math.max(30_000, Number(process.env.RESEND_WEBHOOK_MAX_AGE_MS || 300_000));
  const timestampMs = unixSeconds * 1000;
  return Math.abs(Date.now() - timestampMs) <= toleranceMs;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET || '';
    const strictSignatureMode = process.env.RESEND_WEBHOOK_STRICT_SIGNATURE !== 'false';
    if (secret) {
      const provided = String(event.headers?.['x-webhook-secret'] || event.headers?.['X-Webhook-Secret'] || '').trim();
      const signature = event.headers?.['x-resend-signature'] || event.headers?.['X-Resend-Signature'];
      const rawBody = event.body || '';
      const timestamp = parseWebhookTimestamp(event);
      const timestampedPayload = Number.isFinite(timestamp) ? `${timestamp}.${rawBody}` : rawBody;
      const isLegacySecretValid = provided === secret;
      const isHmacValid =
        isValidHmacSignature(secret, timestampedPayload, signature) ||
        isValidHmacSignature(secret, rawBody, signature);
      const isFresh = !Number.isFinite(timestamp) || isFreshTimestamp(timestamp);
      if (isHmacValid && !isFresh) {
        return json(401, { error: 'Webhook timestamp is stale.' });
      }
      if ((strictSignatureMode && !isHmacValid) || (!strictSignatureMode && !isLegacySecretValid && !isHmacValid)) {
        return json(401, { error: 'Unauthorized' });
      }
    }

    const payload = JSON.parse(event.body || '{}');
    const eventType = payload?.type || payload?.event || 'unknown';
    const providerEmailId = payload?.data?.email_id || payload?.data?.id || payload?.email_id || payload?.id || null;
    const webhookEventId = payload?.webhook_id || payload?.event_id || payload?.id || event.headers?.['x-resend-event-id'] || event.headers?.['X-Resend-Event-Id'] || null;
    if (!providerEmailId) {
      return json(400, { error: 'provider email id is required.' });
    }
    if (webhookEventId) {
      const alreadyProcessed = await isWebhookEventProcessed(String(webhookEventId));
      if (alreadyProcessed) {
        return json(200, { ok: true, duplicate: true });
      }
    }

    const existing = await findEmailDeliveryByProviderId(providerEmailId);
    const key = existing?.deliveryKey || `provider:${providerEmailId}`;
    const next = await upsertEmailDelivery(key, {
      provider: 'resend',
      provider_email_id: providerEmailId,
      status: normalizeStatus(eventType),
      webhook_event_type: eventType,
      webhook_received_at: new Date().toISOString(),
    });

    if (webhookEventId) {
      const dedupeWindowMs = Math.max(60_000, Number(process.env.RESEND_WEBHOOK_DEDUPE_WINDOW_MS || 86_400_000));
      await markWebhookEventProcessed(String(webhookEventId), dedupeWindowMs);
    }

    return json(200, { ok: true, deliveryKey: next.deliveryKey, status: next.status });
  } catch (error) {
    return json(500, { error: error.message || 'Unable to process webhook.' });
  }
};
