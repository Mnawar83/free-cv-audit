const { PAYPAL_CURRENCY, getPayPalAccessToken } = require('./paypal-utils');
const { LINKEDIN_UPSELL_STATUS, getRun, updateRun } = require('./run-store');

const EXPECTED_AMOUNT = '9.99';
const EXPECTED_CURRENCY = (PAYPAL_CURRENCY || 'USD').toUpperCase();

function isValidCapture(data, runId) {
  const unit = data?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amount = capture?.amount;
  const customId = unit?.custom_id || '';
  return (
    data?.status === 'COMPLETED' &&
    capture?.status === 'COMPLETED' &&
    String(amount?.currency_code || '').toUpperCase() === EXPECTED_CURRENCY &&
    amount?.value === EXPECTED_AMOUNT &&
    customId === `linkedin_upsell:${runId}`
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { runId, orderID } = JSON.parse(event.body || '{}');
    if (!runId || !orderID) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId and orderID are required.' }) };
    }

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    if ([LINKEDIN_UPSELL_STATUS.PAID, LINKEDIN_UPSELL_STATUS.GENERATED].includes(run.linkedin_upsell_status)) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyPaid: true }) };
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
      return { statusCode: 502, body: JSON.stringify({ error: 'PayPal order capture failed.', details: await response.text() }) };
    }

    const data = await response.json();
    if (!isValidCapture(data, runId)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid PayPal capture details.' }) };
    }

    const captureId = data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderID;
    await updateRun(runId, () => ({
      linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.PAID,
      linkedin_payment_provider: 'PAYPAL',
      linkedin_payment_id: captureId,
      linkedin_upsell_paid_at: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'PayPal order capture failed.' }) };
  }
};
