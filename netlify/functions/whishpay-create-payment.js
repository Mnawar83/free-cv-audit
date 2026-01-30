const {
  WHISHPAY_AMOUNT,
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { channel } = assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const amount = payload.amount || WHISHPAY_AMOUNT;
    const currency = payload.currency || WHISHPAY_CURRENCY;
    const orderId = payload.orderId || `cv-${Date.now()}`;
    const successUrl = payload.successUrl || WHISHPAY_WEBSITE_URL;
    const failureUrl = payload.failureUrl || WHISHPAY_WEBSITE_URL;
    const description = payload.description || 'Revised CV download';

    const response = await fetch(getWhishPayCreateUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({
        channel,
        amount,
        currency,
        orderId,
        description,
        websiteUrl: WHISHPAY_WEBSITE_URL,
        successUrl,
        failureUrl,
      }),
    });

    const responseText = await response.text();
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

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay order creation failed.' }),
    };
  }
};
