const { getPayPalAccessToken } = require('./paypal-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { orderID } = JSON.parse(event.body || '{}');
    if (!orderID) {
      return { statusCode: 400, body: JSON.stringify({ error: 'orderID is required.' }) };
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
    return { statusCode: 200, body: JSON.stringify({ status: data.status }) };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal order capture failed.' }),
    };
  }
};
