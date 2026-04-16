const { PAYPAL_CURRENCY, getPayPalAccessToken } = require('./paypal-utils');
const { COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');
const { COVER_LETTER_PRICE_STRING } = require('./cover-letter-constants');
const { badRequest, parseJsonBody } = require('./http-400');

const EXPECTED_CURRENCY = (PAYPAL_CURRENCY || 'USD').toUpperCase();

function isValidCapture(data, runId) {
  const unit = data?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amount = capture?.amount;
  return (
    data?.status === 'COMPLETED' &&
    capture?.status === 'COMPLETED' &&
    String(amount?.currency_code || '').toUpperCase() === EXPECTED_CURRENCY &&
    amount?.value === COVER_LETTER_PRICE_STRING &&
    unit?.custom_id === `cover_letter:${runId}`
  );
}

exports.handler = async (event) => {
  const functionName = 'paypal-cover-letter-capture-order';
  const route = '/.netlify/functions/paypal-cover-letter-capture-order';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const { runId, orderID } = parsed.body;
    if (!runId || !orderID) return badRequest({ event, functionName, route, message: !runId ? 'Missing runId.' : 'Missing payment session id (orderID).', payload: parsed.body, missingFields: !runId ? ['runId'] : ['orderID'] });

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    if ([COVER_LETTER_STATUS.PAID, COVER_LETTER_STATUS.GENERATED].includes(run.cover_letter_status)) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyPaid: true }) };
    }

    const { accessToken, baseUrl } = await getPayPalAccessToken();
    const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'PayPal order capture failed.', details: await response.text() }) };
    const data = await response.json();
    if (!isValidCapture(data, runId)) return badRequest({ event, functionName, route, message: 'Invalid PayPal capture details.', payload: parsed.body, invalidFields: ['orderID'] });

    const captureId = data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderID;
    await updateRun(runId, () => ({
      cover_letter_status: COVER_LETTER_STATUS.PAID,
      cover_letter_payment_provider: 'PAYPAL',
      cover_letter_payment_id: captureId,
      cover_letter_paid_at: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'PayPal order capture failed.' }) };
  }
};
