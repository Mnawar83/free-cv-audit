const { getPayPalAccessToken } = require('./paypal-utils');
const {
  createFulfillment,
  createFulfillmentAccessToken,
  enqueueFulfillmentJob,
  getFulfillment,
  getFulfillmentByProviderOrderId,
  markPaymentEventProcessed,
  updateFulfillment,
} = require('./run-store');
const { hasSessionSecretConfigured, createFulfillmentSessionCookie } = require('./fulfillment-auth');

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const orderID = String(payload.orderID || '').trim();
    const requestedFulfillmentId = String(payload.fulfillmentId || '').trim();
    const runId = String(payload.runId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!orderID) {
      return { statusCode: 400, body: JSON.stringify({ error: 'orderID is required.' }) };
    }

    let fulfillment = null;
    let fulfillmentId = requestedFulfillmentId;
    if (requestedFulfillmentId) {
      fulfillment = await getFulfillment(requestedFulfillmentId);
      if (fulfillment && fulfillment.provider !== 'paypal') {
        fulfillment = null;
      }
      if (fulfillment && fulfillment.provider_order_id !== orderID) {
        console.warn('paypal-capture-order received mismatched fulfillment/order pair; falling back to provider lookup.', {
          requestedFulfillmentId,
          orderID,
          storedOrderId: fulfillment.provider_order_id,
        });
        fulfillment = null;
      }
    }
    if (!fulfillment) {
      fulfillment = await getFulfillmentByProviderOrderId('paypal', orderID);
      fulfillmentId = fulfillment?.fulfillment_id || '';
    }

    const { accessToken, baseUrl } = await getPayPalAccessToken();
    const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'PayPal order capture failed.', details: errorData }),
      };
    }

    const data = await response.json();
    const captureStatus = String(data?.status || '').toUpperCase();
    let setCookie = '';
    if (!fulfillment && (captureStatus === 'COMPLETED' || captureStatus === 'SUCCESS' || captureStatus === 'CAPTURED') && runId && email) {
      const existing = await getFulfillmentByProviderOrderId('paypal', orderID);
      if (existing) {
        fulfillment = existing;
        fulfillmentId = existing.fulfillment_id;
      } else {
        const accessToken = createFulfillmentAccessToken();
        fulfillment = await createFulfillment({
          run_id: runId,
          email,
          provider: 'paypal',
          provider_order_id: orderID,
          payment_status: 'PAID',
          paid_at: new Date().toISOString(),
          access_token: accessToken,
        });
        fulfillmentId = fulfillment.fulfillment_id;
        if (hasSessionSecretConfigured()) {
          setCookie = createFulfillmentSessionCookie({
            fulfillmentId: fulfillment.fulfillment_id,
            accessToken,
            expiresAt: fulfillment.access_token_expires_at,
          });
        }
      }
    }
    if (captureStatus === 'COMPLETED' || captureStatus === 'SUCCESS' || captureStatus === 'CAPTURED') {
      if (fulfillmentId) {
        const eventKey = data?.id || `${orderID}:${captureStatus}`;
        const eventState = await markPaymentEventProcessed('paypal', eventKey, JSON.stringify({ orderID, status: captureStatus }));
        if (!eventState?.duplicate) {
          await updateFulfillment(fulfillmentId, {
            payment_status: 'PAID',
            provider_capture_id: data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || data?.id || null,
            paid_at: new Date().toISOString(),
          });
          if (fulfillment && fulfillment.email) {
            await enqueueFulfillmentJob({
              fulfillmentId,
              email: fulfillment.email,
              name: '',
              forceSync: true,
            });
          }
        }
      }
    }

    const updated = fulfillmentId ? await getFulfillmentByProviderOrderId('paypal', orderID) : null;
    return {
      statusCode: 200,
      headers: {
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
      },
      body: JSON.stringify({
        status: data.status,
        paid: updated?.payment_status === 'PAID',
        fulfillmentId: updated?.fulfillment_id || fulfillmentId || null,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order capture failed.' }),
    };
  }
};
