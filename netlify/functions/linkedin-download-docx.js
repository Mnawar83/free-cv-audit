const { getRun } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const runId = event.queryStringParameters?.runId;
  if (!runId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
  }

  const run = await getRun(runId);
  if (!run?.linkedin_docx_base64) {
    return { statusCode: 404, body: JSON.stringify({ error: 'LinkedIn docx not found.' }) };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="LinkedIn_Optimization_${runId}.docx"`,
    },
    body: run.linkedin_docx_base64,
    isBase64Encoded: true,
  };
};
