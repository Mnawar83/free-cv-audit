const { getRun } = require('./run-store');
const { buildPdfBuffer, pdfResponse } = require('./pdf-builder');
const { requireRunOwnerSession } = require('./entitlement-access');

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const runId = event.queryStringParameters?.runId;
    if (!runId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    }

    const run = await getRun(runId);
    const access = requireRunOwnerSession(event, run);
    if (!access.ok) return access.response;
    if (!run?.linkedin_pdf_text) {
      return { statusCode: 404, body: JSON.stringify({ error: 'LinkedIn PDF not found.' }) };
    }

    const inline = event.queryStringParameters?.inline === 'true';
    const pdfBuffer = buildPdfBuffer(run.linkedin_pdf_text);
    return pdfResponse(pdfBuffer, `LinkedIn_Optimization_${runId}.pdf`, inline);
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Download failed.' }) };
  }
};
