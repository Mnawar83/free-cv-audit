const { getRun, updateRun } = require('./run-store');
const { fetchJobPageWithPuppeteer } = require('./job-page-fetcher');

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
