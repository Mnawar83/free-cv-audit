const { COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');
const { COVER_LETTER_PRICE_USD } = require('./cover-letter-constants');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { runId, jobLink } = JSON.parse(event.body || '{}');
    if (!runId || !jobLink) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId and jobLink are required.' }) };
    }

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };

    const next = await updateRun(runId, (existing) => ({
      job_link: jobLink,
      cover_letter_price_usd: existing.cover_letter_price_usd || COVER_LETTER_PRICE_USD,
      cover_letter_status:
        existing.cover_letter_status === COVER_LETTER_STATUS.NOT_STARTED
          ? COVER_LETTER_STATUS.PENDING_PAYMENT
          : existing.cover_letter_status,
      cover_letter_created_at: existing.cover_letter_created_at || new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ status: next.cover_letter_status }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Init failed.' }) };
  }
};
