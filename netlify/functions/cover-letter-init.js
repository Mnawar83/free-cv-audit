const { COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');
const { COVER_LETTER_PRICE_USD } = require('./cover-letter-constants');
const { badRequest, parseJsonBody } = require('./http-400');

exports.handler = async (event) => {
  const functionName = 'cover-letter-init';
  const route = '/.netlify/functions/cover-letter-init';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const parsedBody = parsed.body;
    const runId = String(parsedBody?.runId || '').trim();
    const jobLink = String(parsedBody?.jobLink || parsedBody?.jobUrl || parsedBody?.url || '').trim();
    if (!runId || !jobLink) {
      return badRequest({
        event,
        functionName,
        route,
        message: !runId ? 'Missing runId.' : 'Missing jobLink.',
        payload: parsedBody,
        missingFields: !runId ? ['runId'] : ['jobLink'],
      });
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
