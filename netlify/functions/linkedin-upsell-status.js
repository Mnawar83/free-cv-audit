const { getRun } = require('./run-store');

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
    if (!run) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    }

    const hasDocx = Boolean(run.linkedin_docx_base64);
    const downloadUrl = hasDocx ? `/.netlify/functions/linkedin-download-docx?runId=${encodeURIComponent(runId)}` : undefined;
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: run.linkedin_upsell_status || 'NOT_STARTED',
        hasDocx,
        downloadUrl,
      }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Status failed.' }) };
  }
};
