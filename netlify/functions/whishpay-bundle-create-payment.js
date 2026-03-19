const crypto = require('crypto');
const {
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');
const { LINKEDIN_UPSELL_STATUS, COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');

const BUNDLE_AMOUNT = '8.99';

function generateExternalId() {
  return crypto.randomInt(1_000_000_000_000, 9_999_999_999_999);
}

function appendExternalId(urlString, externalId) {
  try {
    const baseUrl = WHISHPAY_WEBSITE_URL || 'http://localhost';
    const url = new URL(urlString, baseUrl);
    url.searchParams.set('externalId', externalId.toString());
    return url.toString();
  } catch {
    return urlString;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const runId = payload.runId;
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };

    const externalId = generateExternalId();
    const successCallbackUrl = appendExternalId(payload.successCallbackUrl || WHISHPAY_WEBSITE_URL, externalId);
    const failureCallbackUrl = appendExternalId(payload.failureCallbackUrl || WHISHPAY_WEBSITE_URL, externalId);
    const successRedirectUrl = appendExternalId(payload.successRedirectUrl || WHISHPAY_WEBSITE_URL, externalId);
    const failureRedirectUrl = appendExternalId(payload.failureRedirectUrl || WHISHPAY_WEBSITE_URL, externalId);

    const response = await fetch(getWhishPayCreateUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({
        amount: BUNDLE_AMOUNT,
        currency: WHISHPAY_CURRENCY,
        invoice: 'LinkedIn + Cover Letter Bundle',
        externalId,
        metadata: { runId, purpose: 'bundle_upsell' },
        successCallbackUrl,
        failureCallbackUrl,
        successRedirectUrl,
        failureRedirectUrl,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay bundle creation failed.', details: responseText }) };

    let data = {};
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }
    if (data?.status !== true) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay bundle creation failed.', details: data?.dialog || data?.code || data }) };
    }

    await updateRun(runId, (existing) => ({
      bundle_whish_external_id: String(externalId),
      linkedin_upsell_status:
        existing.linkedin_upsell_status === LINKEDIN_UPSELL_STATUS.NOT_STARTED
          ? LINKEDIN_UPSELL_STATUS.PENDING_PAYMENT
          : existing.linkedin_upsell_status,
      cover_letter_status:
        existing.cover_letter_status === COVER_LETTER_STATUS.NOT_STARTED
          ? COVER_LETTER_STATUS.PENDING_PAYMENT
          : existing.cover_letter_status,
    }));

    return { statusCode: 200, body: JSON.stringify({ ...data, externalId }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Whish Pay bundle creation failed.' }) };
  }
};
