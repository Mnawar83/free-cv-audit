const crypto = require('crypto');

const {
  WHISHPAY_AMOUNT,
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');
const { createFulfillment, createFulfillmentAccessToken, getRun } = require('./run-store');
const { hasSessionSecretConfigured, createFulfillmentSessionCookie } = require('./fulfillment-auth');

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
    const sessionSecretAvailable = hasSessionSecretConfigured();
    const functionStart = Date.now();
    console.info('[timing] whishpay-create-payment start', { at: functionStart });
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const runId = String(payload.runId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!runId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    }
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'email is required.' }) };
    }
    const run = await getRun(runId);
    if (!run) {
      return { statusCode: 404, body: JSON.stringify({ error: 'runId was not found. Please run the audit again.' }) };
    }
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

    const providerStart = Date.now();
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
    console.info('[timing] whishpay-create-payment provider response', { ms: Date.now() - providerStart });
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

    let fulfillmentId = '';
    let sessionCookie = '';
    if (sessionSecretAvailable) {
      const fulfillmentAccessToken = createFulfillmentAccessToken();
      const fulfillment = await createFulfillment({
        run_id: runId,
        email,
        provider: 'whishpay',
        provider_order_id: String(externalId),
        payment_status: 'PENDING',
        access_token: fulfillmentAccessToken,
      });
      fulfillmentId = fulfillment.fulfillment_id;
      sessionCookie = createFulfillmentSessionCookie({
        fulfillmentId: fulfillment.fulfillment_id,
        accessToken: fulfillmentAccessToken,
        expiresAt: fulfillment.access_token_expires_at,
      });
    }

    console.info('[timing] whishpay-create-payment complete', { ms: Date.now() - functionStart });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { 'Set-Cookie': sessionCookie } : {}),
      },
      body: JSON.stringify({
        ...data,
        externalId,
        ...(fulfillmentId ? { fulfillmentId } : {}),
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay order creation failed.' }),
    };
  }
};
