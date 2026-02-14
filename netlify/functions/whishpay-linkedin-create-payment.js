const crypto = require('crypto');
const {
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');
const { LINKEDIN_UPSELL_STATUS, getRun } = require('./run-store');

function generateExternalId() {
  return crypto.randomInt(1_000_000_000_000, 9_999_999_999_999);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const runId = payload.runId;
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    if ([LINKEDIN_UPSELL_STATUS.PAID, LINKEDIN_UPSELL_STATUS.GENERATED].includes(run.linkedin_upsell_status)) {
      return { statusCode: 409, body: JSON.stringify({ error: 'LinkedIn upsell already paid.' }) };
    }

    const externalId = generateExternalId();
    const response = await fetch(getWhishPayCreateUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({
        amount: '9.99',
        currency: WHISHPAY_CURRENCY,
        invoice: 'LinkedIn Optimization Upsell',
        externalId,
        metadata: { runId, purpose: 'linkedin_upsell' },
        successCallbackUrl: payload.successCallbackUrl || WHISHPAY_WEBSITE_URL,
        failureCallbackUrl: payload.failureCallbackUrl || WHISHPAY_WEBSITE_URL,
        successRedirectUrl: payload.successRedirectUrl || WHISHPAY_WEBSITE_URL,
        failureRedirectUrl: payload.failureRedirectUrl || WHISHPAY_WEBSITE_URL,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay order creation failed.', details: responseText }) };
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
    return { statusCode: error.statusCode || 500, body: JSON.stringify({ error: error.message || 'Whish Pay order creation failed.' }) };
  }
};
