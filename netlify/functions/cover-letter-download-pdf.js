const { getRun } = require('./run-store');
const { buildPdfBuffer, pdfResponse } = require('./pdf-builder');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const runId = event.queryStringParameters?.runId;
    if (!runId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    }

    const run = await getRun(runId);
    if (!run?.cover_letter_pdf_text) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Cover letter PDF not found.' }) };
    }

    const inline = event.queryStringParameters?.inline === 'true';
    const pdfBuffer = buildPdfBuffer(run.cover_letter_pdf_text);
    return pdfResponse(pdfBuffer, `Cover_Letter_${runId}.pdf`, inline);
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Download failed.' }) };
  }
};
