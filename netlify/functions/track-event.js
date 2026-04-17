const { enqueueAnalyticsEvent, takeRateLimitSlot } = require('./run-store');
const { badRequest, parseJsonBody } = require('./http-400');

const ALLOWED_EVENT_NAMES = new Set([
  'landing_viewed',
  'cv_file_selected',
  'audit_started',
  'audit_completed',
  'audit_failed',
  'payment_succeeded',
  'account_checkout_started',
  'account_subscription_updated',
  'account_subscription_canceled',
  'account_subscription_reactivated',
  'account_billing_portal_opened',
  'account_dashboard_refreshed',
  'workspace_member_invited',
  'workspace_member_updated',
  'workspace_member_removed',
]);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function getClientIp(event) {
  return String(
    event?.headers?.['x-nf-client-connection-ip']
    || event?.headers?.['x-forwarded-for']
    || event?.headers?.['X-Forwarded-For']
    || event?.requestContext?.identity?.sourceIp
    || 'unknown'
  )
    .split(',')[0]
    .trim();
}

exports.handler = async (event) => {
  const functionName = 'track-event';
  const route = '/.netlify/functions/track-event';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body || {};

  const eventName = String(body.eventName || '').trim().toLowerCase();
  if (!eventName) {
    return badRequest({
      event,
      functionName,
      route,
      message: 'Missing eventName.',
      payload: body,
      missingFields: ['eventName'],
    });
  }

  if (!ALLOWED_EVENT_NAMES.has(eventName)) {
    return badRequest({
      event,
      functionName,
      route,
      message: 'Unsupported eventName.',
      payload: body,
      invalidFields: ['eventName'],
    });
  }

  const clientKey = `analytics:${getClientIp(event)}`;
  const windowMs = Math.max(1_000, Number(process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS || 60_000));
  const maxRequests = Math.max(10, Number(process.env.ANALYTICS_RATE_LIMIT_MAX || 120));
  const slot = await takeRateLimitSlot(clientKey, windowMs, maxRequests);
  if (slot?.limited) {
    return json(429, { error: 'Too many requests.' });
  }

  const sessionId = String(body.sessionId || '').trim().slice(0, 120);
  const runId = String(body.runId || '').trim().slice(0, 120);
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
    ? body.context
    : {};

  try {
    await enqueueAnalyticsEvent({
      eventName,
      sessionId,
      runId,
      context,
      source: 'web',
    });
  } catch (error) {
    return json(500, { error: error?.message || 'Unable to persist analytics event.' });
  }

  return json(202, { ok: true });
};
