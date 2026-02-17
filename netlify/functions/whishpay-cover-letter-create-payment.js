const crypto = require('crypto');
const {
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
} = require('./whishpay-utils');
const { COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');
const { COVER_LETTER_PRICE_STRING } = require('./cover-letter-constants');

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
    if ([COVER_LETTER_STATUS.PAID, COVER_LETTER_STATUS.GENERATED].includes(run.cover_letter_status)) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Cover letter already paid.' }) };
    }

    const externalId = generateExternalId();
    const successCallbackUrl = appendExternalId(payload.successCallbackUrl || WHISHPAY_WEBSITE_URL, externalId);
    const failureCallbackUrl = appendExternalId(payload.failureCallbackUrl || WHISHPAY_WEBSITE_URL, externalId);
    const successRedirectUrl = appendExternalId(payload.successRedirectUrl || WHISHPAY_WEBSITE_URL, externalId);
    const failureRedirectUrl = appendExternalId(payload.failureRedirectUrl || WHISHPAY_WEBSITE_URL, externalId);

    const response = await fetch(getWhishPayCreateUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({
        amount: COVER_LETTER_PRICE_STRING,
        currency: WHISHPAY_CURRENCY,
        invoice: 'Cover Letter Upsell',
        externalId,
        metadata: { runId, purpose: 'cover_letter' },
        successCallbackUrl,
        failureCallbackUrl,
        successRedirectUrl,
        failureRedirectUrl,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay order creation failed.', details: responseText }) };

    let data = {};
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }
    if (data?.status !== true) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Whish Pay order creation failed.', details: data?.dialog || data?.code || data }) };
    }

    await updateRun(runId, (existing) => ({
      cover_letter_whish_external_id: String(externalId),
      cover_letter_status:
        existing.cover_letter_status === COVER_LETTER_STATUS.NOT_STARTED
          ? COVER_LETTER_STATUS.PENDING_PAYMENT
          : existing.cover_letter_status,
    }));

    return { statusCode: 200, body: JSON.stringify({ ...data, externalId }) };
  } catch (error) {
    return { statusCode: error.statusCode || 500, body: JSON.stringify({ error: error.message || 'Whish Pay order creation failed.' }) };
  }
};
