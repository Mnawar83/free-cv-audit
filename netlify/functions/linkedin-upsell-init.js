const { LINKEDIN_UPSELL_STATUS, getRun, updateRun } = require('./run-store');
const { badRequest, parseJsonBody } = require('./http-400');

exports.handler = async (event) => {
  const functionName = 'linkedin-upsell-init';
  const route = '/.netlify/functions/linkedin-upsell-init';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const parsedBody = parsed.body;
    const runId = String(parsedBody?.runId || '').trim();
    const providedLinkedInUrl = String(
      parsedBody?.providedLinkedInUrl
      || parsedBody?.providedLinkedinUrl
      || parsedBody?.linkedinUrl
      || parsedBody?.linkedInUrl
      || ''
    ).trim();

    if (!runId || !providedLinkedInUrl) {
      return badRequest({
        event,
        functionName,
        route,
        message: !runId ? 'Missing runId.' : 'Missing providedLinkedInUrl.',
        payload: parsedBody,
        missingFields: !runId ? ['runId'] : ['providedLinkedInUrl'],
      });
    }

    const run = await getRun(runId);
    if (!run) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    }

    const next = await updateRun(runId, (existing) => ({
      provided_linkedin_url: providedLinkedInUrl,
      linkedin_upsell_status:
        existing.linkedin_upsell_status === LINKEDIN_UPSELL_STATUS.NOT_STARTED
          ? LINKEDIN_UPSELL_STATUS.PENDING_PAYMENT
          : existing.linkedin_upsell_status,
      linkedin_upsell_created_at: existing.linkedin_upsell_created_at || new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ status: next.linkedin_upsell_status }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Init failed.' }) };
  }
};
