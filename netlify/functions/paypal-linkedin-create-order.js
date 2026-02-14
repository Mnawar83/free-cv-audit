const { PAYPAL_CURRENCY, getPayPalAccessToken } = require('./paypal-utils');
const { LINKEDIN_UPSELL_STATUS, getRun } = require('./run-store');

const LINKEDIN_AMOUNT = '9.99';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { runId } = JSON.parse(event.body || '{}');
    if (!runId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    }

    const run = await getRun(runId);
    if (!run) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    }

    if ([LINKEDIN_UPSELL_STATUS.PAID, LINKEDIN_UPSELL_STATUS.GENERATED].includes(run.linkedin_upsell_status)) {
      return { statusCode: 409, body: JSON.stringify({ error: 'LinkedIn upsell already paid.' }) };
    }

    const { accessToken, baseUrl } = await getPayPalAccessToken();
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: `linkedin_upsell:${runId}`,
            invoice_id: `linkedin-${runId}`.slice(0, 127),
            amount: { currency_code: PAYPAL_CURRENCY, value: LINKEDIN_AMOUNT },
            description: 'LinkedIn Optimization Upsell',
          },
        ],
      }),
    });

    if (!response.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'PayPal order creation failed.', details: await response.text() }) };
    }

    const data = await response.json();
    return { statusCode: 200, body: JSON.stringify({ orderID: data.id }) };
  } catch (error) {
    return { statusCode: error.statusCode || 500, body: JSON.stringify({ error: error.message || 'PayPal order creation failed.' }) };
  }
};
