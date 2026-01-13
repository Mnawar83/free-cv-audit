const { PAYPAL_AMOUNT, PAYPAL_CURRENCY, assertPayPalConfigured } = require('./paypal-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { clientId } = assertPayPalConfigured();
    return {
      statusCode: 200,
      body: JSON.stringify({
        clientId,
        currency: PAYPAL_CURRENCY,
        amount: PAYPAL_AMOUNT,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'PayPal configuration error.' }),
    };
  }
};
