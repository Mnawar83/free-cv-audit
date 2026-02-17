const { getRun } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const runId = event.queryStringParameters?.runId;
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };

    const hasDocx = Boolean(run.cover_letter_docx_base64);
    const downloadUrl = hasDocx ? `/.netlify/functions/cover-letter-download-docx?runId=${encodeURIComponent(runId)}` : undefined;

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: run.cover_letter_status || 'NOT_STARTED',
        hasDocx,
        downloadUrl,
        lastFetch: {
          jobPageTextLength: Number(run.job_page_text_length || 0),
          jobPageFetchError: run.job_page_fetch_error || '',
        },
      }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Status failed.' }) };
  }
};
