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
  updateFulfillment,
  upsertRun,
} = require('./run-store');
const { hasSessionSecretConfigured, createFulfillmentSessionCookie } = require('./fulfillment-auth');

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const sessionSecretAvailable = hasSessionSecretConfigured();
    const payload = JSON.parse(event.body || '{}');
    const runId = String(payload.runId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!runId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    }
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'email is required.' }) };
    }
    let run = await getRun(runId);
    if (!run) {
      // Retry with increasing delays to handle eventual consistency
      for (let attempt = 1; attempt <= 3 && !run; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        run = await getRun(runId);
      }
      if (!run) {
        await upsertRun(runId, {
          checkout_initialized_at: new Date().toISOString(),
          checkout_provider_hint: 'paypal',
        });
        run = await getRun(runId);
        if (!run) {
          console.warn('Run bootstrap write completed, but immediate read is still unavailable. Continuing checkout.', { runId });
        }
      }
    }

    const functionStart = Date.now();
    console.info('[timing] paypal-create-order start', { at: functionStart });
    const { accessToken, baseUrl } = await getPayPalAccessToken();

    const providerStart = Date.now();
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
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
        ...(fulfillmentId ? { fulfillmentId } : {}),
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order creation failed.' }),
    };
  }
};
