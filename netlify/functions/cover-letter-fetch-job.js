const { getRun, updateRun } = require('./run-store');
const { fetchJobPageWithPuppeteer } = require('./job-page-fetcher');
const { badRequest, parseJsonBody } = require('./http-400');

exports.handler = async (event) => {
  const functionName = 'cover-letter-fetch-job';
  const route = '/.netlify/functions/cover-letter-fetch-job';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const { runId, jobLink } = parsed.body;
    if (!runId || !jobLink) {
      return badRequest({ event, functionName, route, message: !runId ? 'Missing runId.' : 'Missing jobLink.', payload: parsed.body, missingFields: !runId ? ['runId'] : ['jobLink'] });
    }
    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };

    const result = await fetchJobPageWithPuppeteer(jobLink);
    await updateRun(runId, () => ({
      job_link: jobLink,
      job_page_text: result.text,
      job_page_text_length: result.length,
      job_page_fetch_error: result.error || '',
    }));

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Job page fetch failed.' }) };
  }
};
