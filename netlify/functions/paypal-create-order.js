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
    const { accessToken, baseUrl } = await getPayPalAccessToken();

    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        application_context: {
          landing_page: 'GUEST_CHECKOUT',
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

    const data = await response.json();
    return { statusCode: 200, body: JSON.stringify({ id: data.id }) };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order creation failed.' }),
    };
  }
};
