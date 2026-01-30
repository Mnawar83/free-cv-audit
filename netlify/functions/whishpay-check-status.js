const {
  WHISHPAY_CURRENCY,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayStatusUrl,
} = require('./whishpay-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const currency = payload.currency || WHISHPAY_CURRENCY;
    const externalId = payload.externalId;

    if (!externalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'externalId is required.' }) };
    }

    const response = await fetch(getWhishPayStatusUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({ currency, externalId }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Whish Pay status check failed.', details: responseText }),
      };
    }

    let data = {};
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      data = { raw: responseText };
    }

    if (data?.status !== true) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Whish Pay status check failed.',
          details: data?.dialog || data?.code || data,
        }),
      };
    }

    const collectStatus = data?.data?.collectStatus;
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: true,
        collectStatus,
        payerPhoneNumber: data?.data?.payerPhoneNumber,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay status check failed.' }),
    };
  }
};
