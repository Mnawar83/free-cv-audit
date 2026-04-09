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
const { triggerFulfillmentQueueProcessing } = require('./queue-trigger');
const { hasSessionSecretConfigured, createFulfillmentSessionCookie } = require('./fulfillment-auth');

function buildCvUrlForRun(runId) {
  const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || 'https://freecvaudit.com';
  const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
  return new URL(`/.netlify/functions/generate-pdf?runId=${encodeURIComponent(runId)}`, normalizedBaseUrl).toString();
}

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
          const deliveryEmail = String(fulfillment?.email || email || '').trim().toLowerCase();
          await updateFulfillment(fulfillmentId, {
            payment_status: 'PAID',
            email: deliveryEmail || fulfillment?.email || null,
            provider_capture_id: data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || data?.id || null,
            paid_at: new Date().toISOString(),
          });
          if (deliveryEmail) {
            const runIdForDelivery = String(fulfillment?.run_id || runId || '').trim();
            let delivered = false;
            if (runIdForDelivery) {
              try {
                const sendHandler = require('./send-cv-email').handler;
                const sendResponse = await sendHandler({
                  httpMethod: 'POST',
                  body: JSON.stringify({
                    email: deliveryEmail,
                    name: '',
                    cvUrl: buildCvUrlForRun(runIdForDelivery),
                    runId: runIdForDelivery,
                    fulfillmentId,
                    forceSync: true,
                    resend: false,
                  }),
                });
                delivered = sendResponse?.statusCode >= 200 && sendResponse?.statusCode < 300;
              } catch (deliveryError) {
                console.warn('PayPal capture immediate CV email delivery failed; falling back to queue.', {
                  fulfillmentId,
                  error: deliveryError?.message || deliveryError,
                });
              }
            }

            if (!delivered) {
              await enqueueFulfillmentJob({
                fulfillmentId,
                email: deliveryEmail,
                name: '',
                forceSync: true,
              });
              await triggerFulfillmentQueueProcessing();
            }
          }
        }
      }
    }

    const updated = fulfillmentId ? await getFulfillmentByProviderOrderId('paypal', orderID) : null;
    const responseFulfillmentId = setCookie ? (updated?.fulfillment_id || fulfillmentId || null) : null;
    return {
      statusCode: 200,
      headers: {
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
      },
      body: JSON.stringify({
        status: data.status,
        paid: updated?.payment_status === 'PAID',
        fulfillmentId: responseFulfillmentId,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order capture failed.' }),
    };
  }
};
