const { LINKEDIN_UPSELL_STATUS, getRun, updateRun } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { runId, providedLinkedInUrl } = JSON.parse(event.body || '{}');
    if (!runId || !providedLinkedInUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'runId and providedLinkedInUrl are required.' }) };
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
