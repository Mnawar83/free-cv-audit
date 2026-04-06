const { pruneOperationalData } = require('./run-store');

exports.config = {
  schedule: '0 * * * *',
};

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  try {
    const result = await pruneOperationalData({
      deadLetterRetentionMs: Number(process.env.CV_EMAIL_DEAD_LETTER_RETENTION_MS || 7 * 24 * 60 * 60 * 1000),
      completedRetentionMs: Number(process.env.CV_EMAIL_COMPLETED_RETENTION_MS || 7 * 24 * 60 * 60 * 1000),
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Unable to prune operational data.' }),
    };
  }
};
