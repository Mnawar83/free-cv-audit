const {
  WHISHPAY_CURRENCY,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayStatusUrl,
} = require('./whishpay-utils');
const { LINKEDIN_UPSELL_STATUS, COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const { runId, externalId } = payload;
    if (!runId || !externalId) return { statusCode: 400, body: JSON.stringify({ error: 'runId and externalId are required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };

    const expectedExternalId = run.bundle_whish_external_id ? String(run.bundle_whish_external_id) : '';
    if (!expectedExternalId) return { statusCode: 409, body: JSON.stringify({ error: 'Bundle checkout was not initiated for this run.' }) };
    if (String(externalId) !== expectedExternalId) return { statusCode: 403, body: JSON.stringify({ error: 'Whish Pay reference does not match this run.' }) };

    const response = await fetch(getWhishPayStatusUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({ currency: payload.currency || WHISHPAY_CURRENCY, externalId }),
    });
    const responseText = await response.text();
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay status check failed.', details: responseText }) };

    let data = {};
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }
    if (data?.status !== true) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay status check failed.', details: data?.dialog || data?.code || data }) };
    }

    const collectStatus = data?.data?.collectStatus;
    const normalizedCollectStatus = String(collectStatus || '').toLowerCase();
    const isPaidStatus = ['paid', 'success', 'collected'].includes(normalizedCollectStatus);
    if (isPaidStatus) {
      await updateRun(runId, (existing) => ({
        linkedin_upsell_status: existing.linkedin_upsell_status === LINKEDIN_UPSELL_STATUS.GENERATED ? LINKEDIN_UPSELL_STATUS.GENERATED : LINKEDIN_UPSELL_STATUS.PAID,
        linkedin_payment_provider: 'WHISH_BUNDLE',
        linkedin_payment_id: String(externalId),
        linkedin_upsell_paid_at: new Date().toISOString(),
        cover_letter_status: existing.cover_letter_status === COVER_LETTER_STATUS.GENERATED ? COVER_LETTER_STATUS.GENERATED : COVER_LETTER_STATUS.PAID,
        cover_letter_payment_provider: 'WHISH_BUNDLE',
        cover_letter_payment_id: String(externalId),
        cover_letter_paid_at: new Date().toISOString(),
      }));
    }

    return { statusCode: 200, body: JSON.stringify({ status: true, collectStatus, isPaidStatus }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Whish Pay status check failed.' }) };
  }
};
