const {
  computeFulfillmentAccessTokenExpiresAt,
  createFulfillmentAccessToken,
  doesFulfillmentAccessTokenMatch,
  getFulfillment,
  hashFulfillmentAccessToken,
  takeRateLimitSlot,
  updateFulfillment,
} = require('./run-store');
const {
  clearFulfillmentSessionCookie,
  createFulfillmentSessionCookie,
  getAccessTokenFromSessionCookie,
  getSetCookieValues,
  validateCsrfOrigin,
} = require('./fulfillment-auth');
const { handler: sendCvEmailHandler } = require('./send-cv-email');

function json(statusCode, payload, extraHeaders = {}, setCookies = []) {
  const response = {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  };
  if (Array.isArray(setCookies) && setCookies.length > 0) {
    response.headers['Set-Cookie'] = setCookies[0];
    response.multiValueHeaders = { 'Set-Cookie': setCookies };
  }
  return response;
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
    const email = String(payload.email || '').trim().toLowerCase();
    const name = String(payload.name || '').trim();
    const forceSync = Boolean(payload.forceSync);

    if (!fulfillmentId) {
      return json(400, { error: 'fulfillmentId is required.' });
    }
    if (!email) {
      return json(400, { error: 'email is required.' });
    }
    const windowMs = Math.max(1_000, Number(process.env.FULFILLMENT_RESEND_RATE_LIMIT_WINDOW_MS || 60_000));
    const maxRequests = Math.max(1, Number(process.env.FULFILLMENT_RESEND_RATE_LIMIT_MAX || 5));
    const forwarded = String(event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0].trim();
    const clientKey = `${forwarded || 'unknown-ip'}:fulfillment-resend:${fulfillmentId}`;
    const slot = await takeRateLimitSlot(clientKey, windowMs, maxRequests);
    if (slot?.limited) {
      return json(429, { error: 'Too many resend attempts. Please wait before trying again.' });
    }

    const fulfillment = await getFulfillment(fulfillmentId);
    if (!fulfillment) {
      return json(404, { error: 'fulfillment was not found.' });
    }
    if (!doesFulfillmentAccessTokenMatch(fulfillment, accessToken)) {
      return json(
        403,
        { error: 'fulfillment access token is invalid.' },
        {},
        getSetCookieValues(event, clearFulfillmentSessionCookie(fulfillmentId))
      );
    }
    const originalEmail = String(fulfillment.email || '').trim().toLowerCase();
    if (originalEmail && email !== originalEmail) {
      return json(403, { error: 'email does not match the original fulfillment recipient.' });
    }
    if (String(fulfillment.payment_status || '').toUpperCase() !== 'PAID') {
      return json(409, { error: 'Payment is not confirmed yet for this fulfillment.' });
    }
    if (!fulfillment.run_id) {
      return json(409, { error: 'fulfillment is missing run context.' });
    }

    const baseUrl =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      process.env.DEPLOY_URL ||
      'https://freecvaudit.com';
    const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
    const cvUrl = new URL(`/.netlify/functions/generate-pdf?runId=${encodeURIComponent(fulfillment.run_id)}`, normalizedBaseUrl).toString();

    const sendResult = await sendCvEmailHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        email,
        name,
        cvUrl,
        runId: fulfillment.run_id,
        fulfillmentId,
        resend: true,
        forceSync,
      }),
    });
    let parsedSendResult = {};
    try {
      parsedSendResult = JSON.parse(sendResult.body || '{}');
    } catch (parseError) {
      parsedSendResult = {};
    }
    if (sendResult.statusCode >= 200 && sendResult.statusCode < 300) {
      const rotatedAccessToken = createFulfillmentAccessToken();
      const rotatedExpiresAt = computeFulfillmentAccessTokenExpiresAt();
      await updateFulfillment(fulfillmentId, {
        access_token: null,
        access_token_hash: hashFulfillmentAccessToken(rotatedAccessToken),
        access_token_expires_at: rotatedExpiresAt,
        last_resend_token_rotated_at: new Date().toISOString(),
      });
      const setCookie = createFulfillmentSessionCookie({
        fulfillmentId,
        accessToken: rotatedAccessToken,
        expiresAt: rotatedExpiresAt,
      });
      return json(sendResult.statusCode, {
        ...parsedSendResult,
      }, {}, getSetCookieValues(event, setCookie));
    }
    return sendResult;
  } catch (error) {
    return json(500, { error: error.message || 'Unable to resend fulfillment email.' });
  }
};
