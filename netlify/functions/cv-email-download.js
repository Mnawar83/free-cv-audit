const { getEmailDownloadSnapshot } = require('./email-download-store');
const { buildPdfBuffer, pdfResponse } = require('./pdf-builder');

function htmlErrorResponse(statusCode, message) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unable to Load Your CV</title></head><body style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc;color:#334155;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
<h1 style="margin:0 0 12px;color:#0f172a;">Unable to Load Your CV</h1><p style="margin:0;">${message}</p>
</div></body></html>`;
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const token = String(event.queryStringParameters?.token || '').trim();
    if (!token) {
      return htmlErrorResponse(400, 'The link is missing a download token. Please request a new email.');
    }

    const snapshot = await getEmailDownloadSnapshot(event, token);
    if (!snapshot?.revised_cv_text) {
      return htmlErrorResponse(404, 'Your revised CV could not be found. Please request a new download link.');
    }
    if (snapshot.expires_at && new Date(snapshot.expires_at).getTime() < Date.now()) {
      return htmlErrorResponse(410, 'This download link has expired. Please request a new one.');
    }

    const pdfBuffer = buildPdfBuffer(snapshot.revised_cv_text);
    return pdfResponse(pdfBuffer, 'revised-cv.pdf', true);
  } catch (error) {
    return htmlErrorResponse(500, error.message || 'Unable to load your revised CV right now.');
  }
};
