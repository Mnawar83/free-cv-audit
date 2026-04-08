const { createRunId, upsertRun } = require('./run-store');

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (e) {}

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { cvText } = JSON.parse(event.body || '{}');
    if (!cvText || String(cvText).trim().length < 50) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'cvText is required.' }),
      };
    }

    const runId = createRunId();
    await upsertRun(runId, {
      original_cv_text: String(cvText),
      audit_preview_initialized_at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
