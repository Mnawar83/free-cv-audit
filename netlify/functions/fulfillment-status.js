const { doesFulfillmentAccessTokenMatch, getFulfillment, takeRateLimitSlot } = require('./run-store');
const { clearFulfillmentSessionCookie, getAccessTokenFromSessionCookie, validateCsrfOrigin } = require('./fulfillment-auth');

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const csrfError = validateCsrfOrigin(event);
    if (csrfError) {
      return json(403, { error: `csrf validation failed: ${csrfError}` });
    }
    const payload = JSON.parse(event.body || '{}');
    const fulfillmentId = String(payload.fulfillmentId || '').trim();
    const accessToken = getAccessTokenFromSessionCookie(event, fulfillmentId);
    if (!fulfillmentId) {
      return json(400, { error: 'fulfillmentId is required.' });
    }
    const windowMs = Math.max(1_000, Number(process.env.FULFILLMENT_STATUS_RATE_LIMIT_WINDOW_MS || 60_000));
    const maxRequests = Math.max(1, Number(process.env.FULFILLMENT_STATUS_RATE_LIMIT_MAX || 60));
    const forwarded = String(event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0].trim();
    const clientKey = `${forwarded || 'unknown-ip'}:fulfillment-status:${fulfillmentId}`;
    const slot = await takeRateLimitSlot(clientKey, windowMs, maxRequests);
    if (slot?.limited) {
      return json(429, { error: 'Too many status checks. Please try again shortly.' });
    }

    const fulfillment = await getFulfillment(fulfillmentId);
    if (!fulfillment) {
      return json(404, { error: 'fulfillment was not found.' });
    }
    if (!doesFulfillmentAccessTokenMatch(fulfillment, accessToken)) {
      return json(403, { error: 'fulfillment access token is invalid.' }, { 'Set-Cookie': clearFulfillmentSessionCookie(fulfillmentId) });
    }

    return json(200, {
      ok: true,
      fulfillmentId: fulfillment.fulfillment_id,
      paymentStatus: fulfillment.payment_status || 'PENDING',
    });
  } catch (error) {
    return json(500, { error: error.message || 'Unable to load fulfillment status.' });
  }
};
