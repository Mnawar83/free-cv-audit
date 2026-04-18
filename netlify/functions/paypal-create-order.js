const {
  PAYPAL_AMOUNT,
  PAYPAL_CURRENCY,
  getPayPalAccessToken,
} = require('./paypal-utils');
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
const { isValidEmail } = require('./utils/validation');


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
  const functionName = 'paypal-create-order';
  const route = '/.netlify/functions/paypal-create-order';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const csrfError = validateCsrfOrigin(event);
    if (csrfError) return { statusCode: 403, body: JSON.stringify({ error: `csrf validation failed: ${csrfError}` }) };
    if (await enforceRateLimit(event, { keyPrefix: 'paypal-create-order', windowMsEnv: 'PAYMENT_RATE_LIMIT_WINDOW_MS', maxEnv: 'PAYMENT_RATE_LIMIT_MAX', defaults: { windowMs: 60_000, max: 20 } })) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }) };
    }
    const sessionSecretAvailable = hasSessionSecretConfigured();
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

    const functionStart = Date.now();
    console.info('[timing] paypal-create-order start', { at: functionStart });
    const { accessToken, baseUrl } = await getPayPalAccessToken();

    const providerStart = Date.now();
    const response = await fetchWithRetry(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        application_context: {
          landing_page: 'BILLING',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
        purchase_units: [
          {
            amount: {
              currency_code: PAYPAL_CURRENCY,
              value: PAYPAL_AMOUNT,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'PayPal order creation failed.', details: errorData }),
      };
    }

    console.info('[timing] paypal-create-order provider response', { ms: Date.now() - providerStart });
    const data = await response.json();
    const approveLink = Array.isArray(data.links)
      ? data.links.find((link) => link.rel === 'approve')?.href
      : null;
    let fulfillmentId = '';
    let sessionCookie = '';
    const existingFulfillment = await getFulfillmentByProviderOrderId('paypal', data.id);
    let fulfillment = existingFulfillment;
    let fulfillmentAccessToken = '';
    if (!fulfillment) {
      fulfillmentAccessToken = createFulfillmentAccessToken();
      fulfillment = await createFulfillment({
        run_id: runId,
        email,
        provider: 'paypal',
        provider_order_id: data.id,
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
        console.warn('PayPal fulfillment session cookie skipped: existing fulfillment does not expose recoverable access token.', {
          providerOrderId: data.id,
          fulfillmentId,
        });
      }
    }
    console.info('[timing] paypal-create-order complete', { ms: Date.now() - functionStart });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { 'Set-Cookie': sessionCookie } : {}),
      },
      body: JSON.stringify({
        id: data.id,
        approvalUrl: approveLink,
        ...((sessionCookie && fulfillmentId) ? { fulfillmentId } : {}),
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order creation failed.' }),
    };
  }
};
