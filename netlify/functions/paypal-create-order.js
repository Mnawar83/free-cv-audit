const {
  PAYPAL_AMOUNT,
  PAYPAL_CURRENCY,
  getPayPalAccessToken,
} = require('./paypal-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
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
    console.info('[timing] paypal-create-order complete', { ms: Date.now() - functionStart });
    return { statusCode: 200, body: JSON.stringify({ id: data.id, approvalUrl: approveLink }) };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order creation failed.' }),
    };
  }
};
