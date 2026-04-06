const { getPayPalAccessToken } = require('./paypal-utils');
const {
  enqueueFulfillmentJob,
  getFulfillment,
  getFulfillmentByProviderOrderId,
  markPaymentEventProcessed,
  updateFulfillment,
} = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { orderID, fulfillmentId } = JSON.parse(event.body || '{}');
    if (!orderID) {
      return { statusCode: 400, body: JSON.stringify({ error: 'orderID is required.' }) };
    }
    if (!fulfillmentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'fulfillmentId is required.' }) };
    }

    const fulfillment = await getFulfillment(fulfillmentId);
    if (!fulfillment) {
      return { statusCode: 404, body: JSON.stringify({ error: 'fulfillment was not found.' }) };
    }
    if (fulfillment.provider !== 'paypal') {
      return { statusCode: 400, body: JSON.stringify({ error: 'fulfillment provider mismatch.' }) };
    }
    if (fulfillment.provider_order_id !== orderID) {
      return { statusCode: 409, body: JSON.stringify({ error: 'orderID does not match fulfillment record.' }) };
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
    if (captureStatus === 'COMPLETED' || captureStatus === 'SUCCESS' || captureStatus === 'CAPTURED') {
      const eventKey = data?.id || `${orderID}:${captureStatus}`;
      const eventState = await markPaymentEventProcessed('paypal', eventKey, JSON.stringify({ orderID, status: captureStatus }));
      if (!eventState?.duplicate) {
        await updateFulfillment(fulfillmentId, {
          payment_status: 'PAID',
          provider_capture_id: data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || data?.id || null,
          paid_at: new Date().toISOString(),
        });
        if (fulfillment.email) {
          await enqueueFulfillmentJob({
            fulfillmentId,
            email: fulfillment.email,
            name: '',
            forceSync: true,
          });
        }
      }
    }

    const updated = await getFulfillmentByProviderOrderId('paypal', orderID);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: data.status,
        paid: updated?.payment_status === 'PAID',
        fulfillmentId,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order capture failed.' }),
    };
  }
};
