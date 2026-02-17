const { getRun } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const runId = event.queryStringParameters?.runId;
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    const run = await getRun(runId);
    if (!run?.cover_letter_docx_base64) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Cover letter docx not found.' }) };
    }

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="Cover_Letter_${runId}.docx"`,
      },
      body: run.cover_letter_docx_base64,
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Download failed.' }) };
  }
};
