const { buildPdfBuffer } = require('./pdf-builder');
const { saveEmailDownloadSnapshot } = require('./email-download-store');
const {
  computeFulfillmentAccessTokenExpiresAt,
  createFulfillmentAccessToken,
  createArtifactToken,
  doesFulfillmentAccessTokenMatch,
  createEmailDownloadToken,
  getFulfillment,
  getRun,
  hashFulfillmentAccessToken,
  takeRateLimitSlot,
  updateFulfillment,
} = require('./run-store');
const {
  clearFulfillmentSessionCookie,
  createFulfillmentSessionCookie,
  getAccessTokenFromSessionCookie,
  validateCsrfOrigin,
} = require('./fulfillment-auth');

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  };
}

function resolveBaseUrl() {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || 'https://freecvaudit.com';
  return /^https?:\/\//i.test(base) ? base : `https://${base}`;
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const csrfError = validateCsrfOrigin(event);
    if (csrfError) {
      return json(403, { error: `csrf validation failed: ${csrfError}` });
    }
    const payload = JSON.parse(event.body || '{}');
    const fulfillmentId = String(payload.fulfillmentId || '').trim();
    const accessToken = getAccessTokenFromSessionCookie(event, fulfillmentId);
    if (!fulfillmentId) return json(400, { error: 'fulfillmentId is required.' });

    const forwarded = String(event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0].trim();
    const windowMs = Math.max(1_000, Number(process.env.FULFILLMENT_REISSUE_RATE_LIMIT_WINDOW_MS || 60_000));
    const maxRequests = Math.max(1, Number(process.env.FULFILLMENT_REISSUE_RATE_LIMIT_MAX || 5));
    const slot = await takeRateLimitSlot(`${forwarded || 'unknown-ip'}:fulfillment-reissue:${fulfillmentId}`, windowMs, maxRequests);
    if (slot?.limited) return json(429, { error: 'Too many reissue attempts. Please try again later.' });

    const fulfillment = await getFulfillment(fulfillmentId);
    if (!fulfillment) return json(404, { error: 'fulfillment was not found.' });
    if (!doesFulfillmentAccessTokenMatch(fulfillment, accessToken)) {
      return json(403, { error: 'fulfillment access token is invalid.' }, { 'Set-Cookie': clearFulfillmentSessionCookie(fulfillmentId) });
    }
    if (String(fulfillment.payment_status || '').toUpperCase() !== 'PAID') {
      return json(409, { error: 'Payment is not confirmed yet for this fulfillment.' });
    }
    if (!fulfillment.run_id) return json(409, { error: 'fulfillment is missing run context.' });

    const run = await getRun(fulfillment.run_id);
    const revisedCvText = String(run?.revised_cv_text || '');
    if (!revisedCvText) {
      return json(404, { error: 'Revised CV could not be recovered for this fulfillment.' });
    }
    const pdfBase64 = buildPdfBuffer(revisedCvText).toString('base64');
    const token = createEmailDownloadToken();
    const ttlDays = Math.min(90, Math.max(1, Number(process.env.CV_EMAIL_LINK_TTL_DAYS || 30)));
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    await createArtifactToken({
      token,
      runId: fulfillment.run_id,
      fulfillmentId,
      pdf_base64: pdfBase64,
      revised_cv_text: revisedCvText,
      expires_at: expiresAt,
    });
    await saveEmailDownloadSnapshot(event, token, {
      runId: fulfillment.run_id,
      pdf_base64: pdfBase64,
      revised_cv_text: revisedCvText,
      expires_at: expiresAt,
    });

    const rotatedAccessToken = createFulfillmentAccessToken();
    const rotatedExpiresAt = computeFulfillmentAccessTokenExpiresAt();
    await updateFulfillment(fulfillmentId, {
      last_reissued_token_at: new Date().toISOString(),
      access_token: null,
      access_token_hash: hashFulfillmentAccessToken(rotatedAccessToken),
      access_token_expires_at: rotatedExpiresAt,
    });
    const setCookie = createFulfillmentSessionCookie({
      fulfillmentId,
      accessToken: rotatedAccessToken,
      expiresAt: rotatedExpiresAt,
    });

    const downloadUrl = new URL(`/.netlify/functions/cv-email-download?token=${encodeURIComponent(token)}`, resolveBaseUrl()).toString();
    return json(200, { ok: true, token, downloadUrl, expiresAt }, setCookie ? { 'Set-Cookie': setCookie } : {});
  } catch (error) {
    return json(500, { error: error.message || 'Unable to reissue download link.' });
  }
};
