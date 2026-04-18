const crypto = require('crypto');
const { isValidEmail, isValidUrl } = require('./utils/validation');

const {
  WHISHPAY_AMOUNT,
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');
const {
  createFulfillment,
  createFulfillmentAccessToken,
  getFulfillmentByProviderOrderId,
  getRun,
  updateFulfillment
} = require('./run-store');
const { hasSessionSecretConfigured, createFulfillmentSessionCookie } = require('./fulfillment-auth');
const { badRequest, parseJsonBody } = require('./http-400');
const { enforceRateLimit, validateCsrfOrigin } = require('./request-guards');

function generateExternalId() {
  return crypto.randomUUID();
}

function resolveCallbackUrl(candidate, fallback) {
  return isValidUrl(candidate) ? candidate : fallback;
}

function appendExternalId(urlString, externalId) {
  try {
    const url = new URL(urlString);
    url.searchParams.set('externalId', externalId.toString());
    return url.toString();
  } catch (error) {
    return urlString;
  }
}


function retryDelayMs(attempt) {
  const base = 250 * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

async function fetchWithRetry(url, options, retries = 2) {
  let lastResponse = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      lastResponse = response;
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) {
        return response;
      }
    } catch (error) {
      if (attempt === retries) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
  }
  return lastResponse;
}

exports.handler = async (event) => {
  const functionName = 'whishpay-create-payment';
  const route = '/.netlify/functions/whishpay-create-payment';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const csrfError = validateCsrfOrigin(event);
    if (csrfError) return { statusCode: 403, body: JSON.stringify({ error: `csrf validation failed: ${csrfError}` }) };
    if (await enforceRateLimit(event, { keyPrefix: 'whishpay-create-payment', windowMsEnv: 'PAYMENT_RATE_LIMIT_WINDOW_MS', maxEnv: 'PAYMENT_RATE_LIMIT_MAX', defaults: { windowMs: 60_000, max: 20 } })) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }) };
    }
    const sessionSecretAvailable = hasSessionSecretConfigured();
    const functionStart = Date.now();
    console.info('[timing] whishpay-create-payment start', { at: functionStart });
    assertWhishPayConfigured();
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const payload = parsed.body;
    const runId = String(payload.runId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!runId) {
      return badRequest({ event, functionName, route, message: 'Missing runId.', payload, missingFields: ['runId'] });
    }
    if (!email || !isValidEmail(email)) {
      return badRequest({ event, functionName, route, message: 'Valid email is required.', payload, invalidFields: ['email'] });
    }
    let run = await getRun(runId);
    if (!run) {
      // Retry with increasing delays to handle eventual consistency
      for (let attempt = 1; attempt <= 3 && !run; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        run = await getRun(runId);
      }
      if (!run) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
      }
    }
    const amount = WHISHPAY_AMOUNT;
    const currency = WHISHPAY_CURRENCY;
    const externalId = generateExternalId();
    const invoice = payload.invoice || 'Revised CV download';
    const successCallbackUrl = appendExternalId(
      resolveCallbackUrl(payload.successCallbackUrl, WHISHPAY_WEBSITE_URL),
      externalId,
    );
    const failureCallbackUrl = appendExternalId(
      resolveCallbackUrl(payload.failureCallbackUrl, WHISHPAY_WEBSITE_URL),
      externalId,
    );
    const successRedirectUrl = appendExternalId(
      resolveCallbackUrl(payload.successRedirectUrl, WHISHPAY_WEBSITE_URL),
      externalId,
    );
    const failureRedirectUrl = appendExternalId(
      resolveCallbackUrl(payload.failureRedirectUrl, WHISHPAY_WEBSITE_URL),
      externalId,
    );

    const providerStart = Date.now();
    const response = await fetchWithRetry(getWhishPayCreateUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({
        amount,
        currency,
        invoice,
        externalId,
        successCallbackUrl,
        failureCallbackUrl,
        successRedirectUrl,
        failureRedirectUrl,
      }),
    });

    const responseText = await response.text();
    console.info('[timing] whishpay-create-payment provider response', { ms: Date.now() - providerStart });
    if (!response.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Whish Pay order creation failed.', details: responseText }),
      };
    }

    let data = {};
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      data = { raw: responseText };
    }

    if (data?.status !== true) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Whish Pay order creation failed.',
          details: data?.dialog || data?.code || data,
        }),
      };
    }

    let fulfillmentId = '';
    let sessionCookie = '';
    const existingFulfillment = await getFulfillmentByProviderOrderId('whishpay', String(externalId));
    let fulfillment = existingFulfillment;
    let fulfillmentAccessToken = '';
    if (!fulfillment) {
      fulfillmentAccessToken = createFulfillmentAccessToken();
      fulfillment = await createFulfillment({
        run_id: runId,
        email,
        provider: 'whishpay',
        provider_order_id: String(externalId),
        payment_status: 'PENDING',
        access_token: fulfillmentAccessToken,
      });
    } else if (!fulfillment.email || fulfillment.email !== email) {
      fulfillment = await updateFulfillment(fulfillment.fulfillment_id, {
        email,
      });
    }
    fulfillmentId = fulfillment?.fulfillment_id || '';
    if (sessionSecretAvailable) {
      if (fulfillmentAccessToken && fulfillment) {
        sessionCookie = createFulfillmentSessionCookie({
          fulfillmentId: fulfillment.fulfillment_id,
          accessToken: fulfillmentAccessToken,
          expiresAt: fulfillment.access_token_expires_at,
        });
      } else {
        console.warn('WhishPay fulfillment session cookie skipped: existing fulfillment does not expose recoverable access token.', {
          providerOrderId: String(externalId),
          fulfillmentId,
        });
      }
    }

    console.info('[timing] whishpay-create-payment complete', { ms: Date.now() - functionStart });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { 'Set-Cookie': sessionCookie } : {}),
      },
      body: JSON.stringify({
        ...data,
        externalId,
        ...(fulfillmentId ? { fulfillmentId } : {}),
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay order creation failed.' }),
    };
  }
};
