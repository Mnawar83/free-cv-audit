const {
  WHISHPAY_CURRENCY,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayStatusUrl,
} = require('./whishpay-utils');
const { LINKEDIN_UPSELL_STATUS, getRun, updateRun } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const { runId, externalId } = payload;
    if (!runId || !externalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId and externalId are required.' }) };
    }

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    if ([LINKEDIN_UPSELL_STATUS.PAID, LINKEDIN_UPSELL_STATUS.GENERATED].includes(run.linkedin_upsell_status)) {
      return { statusCode: 200, body: JSON.stringify({ status: true, collectStatus: 'PAID' }) };
    }

    const response = await fetch(getWhishPayStatusUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({ currency: payload.currency || WHISHPAY_CURRENCY, externalId }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay status check failed.', details: responseText }) };
    }

    const data = JSON.parse(responseText);
    const collectStatus = data?.data?.collectStatus;
    if (collectStatus === 'PAID') {
      await updateRun(runId, () => ({
        linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.PAID,
        linkedin_payment_provider: 'WHISH',
        linkedin_payment_id: String(externalId),
        linkedin_upsell_paid_at: new Date().toISOString(),
      }));
    }

    return { statusCode: 200, body: JSON.stringify({ status: true, collectStatus }) };
  } catch (error) {
    return { statusCode: error.statusCode || 500, body: JSON.stringify({ error: error.message || 'Whish Pay status check failed.' }) };
  }
};
