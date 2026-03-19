const { PAYPAL_CURRENCY, getPayPalAccessToken } = require('./paypal-utils');
const { LINKEDIN_UPSELL_STATUS, COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');

const EXPECTED_AMOUNT = '8.99';
const EXPECTED_CURRENCY = (PAYPAL_CURRENCY || 'USD').toUpperCase();

function isValidCapture(data, runId) {
  const unit = data?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amount = capture?.amount;
  return (
    data?.status === 'COMPLETED' &&
    capture?.status === 'COMPLETED' &&
    String(amount?.currency_code || '').toUpperCase() === EXPECTED_CURRENCY &&
    amount?.value === EXPECTED_AMOUNT &&
    unit?.custom_id === `bundle_upsell:${runId}`
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { runId, orderID } = JSON.parse(event.body || '{}');
    if (!runId || !orderID) return { statusCode: 400, body: JSON.stringify({ error: 'runId and orderID are required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };

    const { accessToken, baseUrl } = await getPayPalAccessToken();
    const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'PayPal bundle capture failed.', details: await response.text() }) };

    const data = await response.json();
    if (!isValidCapture(data, runId)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid PayPal bundle capture details.' }) };

    const captureId = data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderID;
    await updateRun(runId, (existing) => ({
      linkedin_upsell_status: existing.linkedin_upsell_status === LINKEDIN_UPSELL_STATUS.GENERATED ? LINKEDIN_UPSELL_STATUS.GENERATED : LINKEDIN_UPSELL_STATUS.PAID,
      linkedin_payment_provider: 'PAYPAL_BUNDLE',
      linkedin_payment_id: captureId,
      linkedin_upsell_paid_at: new Date().toISOString(),
      cover_letter_status: existing.cover_letter_status === COVER_LETTER_STATUS.GENERATED ? COVER_LETTER_STATUS.GENERATED : COVER_LETTER_STATUS.PAID,
      cover_letter_payment_provider: 'PAYPAL_BUNDLE',
      cover_letter_payment_id: captureId,
      cover_letter_paid_at: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'PayPal bundle capture failed.' }) };
  }
};
