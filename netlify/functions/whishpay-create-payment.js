const crypto = require('crypto');

const {
  WHISHPAY_AMOUNT,
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');

function generateExternalId() {
  return crypto.randomInt(1_000_000_000_000, 9_999_999_999_999);
}

function appendExternalId(urlString, externalId) {
  try {
    const url = new URL(urlString);
    url.searchParams.set('externalId', externalId.toString());
    return url.toString();
  } catch (error) {
    return urlString;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const amount = WHISHPAY_AMOUNT;
    const currency = WHISHPAY_CURRENCY;
    const externalId = generateExternalId();
    const invoice = payload.invoice || 'Revised CV download';
    const successCallbackUrl = appendExternalId(
      payload.successCallbackUrl || WHISHPAY_WEBSITE_URL,
      externalId,
    );
    const failureCallbackUrl = appendExternalId(
      payload.failureCallbackUrl || WHISHPAY_WEBSITE_URL,
      externalId,
    );
    const successRedirectUrl = appendExternalId(
      payload.successRedirectUrl || WHISHPAY_WEBSITE_URL,
      externalId,
    );
    const failureRedirectUrl = appendExternalId(
      payload.failureRedirectUrl || WHISHPAY_WEBSITE_URL,
      externalId,
    );

    const response = await fetch(getWhishPayCreateUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({
        amount,
        currency,
        invoice,
        externalId,
        successCallbackUrl,
        failureCallbackUrl,
        successRedirectUrl,
        failureRedirectUrl,
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

    if (data?.status !== true) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Whish Pay order creation failed.',
          details: data?.dialog || data?.code || data,
        }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ ...data, externalId }) };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay order creation failed.' }),
    };
  }
};
