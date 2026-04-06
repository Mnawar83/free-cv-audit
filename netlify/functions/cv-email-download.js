const { getEmailDownloadSnapshot } = require('./email-download-store');
const { buildPdfBuffer, pdfResponse } = require('./pdf-builder');
const { getArtifactToken, incrementArtifactTokenDownload, takeRateLimitSlot } = require('./run-store');

function normalizeBase64Pdf(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw) return '';
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return '';
  return raw;
}

function getClientKey(event, token) {
  const forwarded = String(event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '').split(',')[0].trim();
  const sourceIp = forwarded || 'unknown-ip';
  return `${sourceIp}:${token}`;
}

async function isRateLimited(event, token) {
  const windowMs = Math.max(1_000, Number(process.env.CV_DOWNLOAD_RATE_LIMIT_WINDOW_MS || 60_000));
  const maxRequests = Math.max(1, Number(process.env.CV_DOWNLOAD_RATE_LIMIT_MAX || 30));
  const key = getClientKey(event, token);
  const result = await takeRateLimitSlot(key, windowMs, maxRequests);
  return Boolean(result?.limited);
}

function htmlErrorResponse(statusCode, message) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unable to Load Your CV</title></head><body style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc;color:#334155;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
<h1 style="margin:0 0 12px;color:#0f172a;">Unable to Load Your CV</h1><p style="margin:0;">${message}</p>
</div></body></html>`;
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
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
    if (await isRateLimited(event, token)) {
      return htmlErrorResponse(429, 'Too many download attempts. Please wait a minute and try again.');
    }

    const artifactToken = await getArtifactToken(token);
    const snapshot = artifactToken || (await getEmailDownloadSnapshot(event, token));
    const pdfBase64 = normalizeBase64Pdf(snapshot?.pdf_base64);
    if (!snapshot?.revised_cv_text && !pdfBase64) {
      return htmlErrorResponse(404, 'Your revised CV could not be found. Please request a new download link.');
    }
    if (snapshot.expires_at && new Date(snapshot.expires_at).getTime() < Date.now()) {
      return htmlErrorResponse(410, 'This download link has expired. Please request a new one.');
    }
    const maxDownloads = Math.max(0, Number(snapshot.max_downloads || 0));
    const downloadCount = Math.max(0, Number(snapshot.download_count || 0));
    if (maxDownloads > 0 && downloadCount >= maxDownloads) {
      return htmlErrorResponse(410, 'This download link has reached its maximum number of downloads. Please request a new one.');
    }

    if (pdfBase64) {
      await incrementArtifactTokenDownload(token).catch(() => null);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="revised-cv.pdf"',
          'Cache-Control': 'no-store',
        },
        body: pdfBase64,
        isBase64Encoded: true,
      };
    }

    const pdfBuffer = buildPdfBuffer(snapshot.revised_cv_text);
    await incrementArtifactTokenDownload(token).catch(() => null);
    const generated = pdfResponse(pdfBuffer, 'revised-cv.pdf', true);
    generated.headers = {
      ...generated.headers,
      'Cache-Control': 'no-store',
    };
    return generated;
  } catch (error) {
    return htmlErrorResponse(500, error.message || 'Unable to load your revised CV right now.');
  }
};
