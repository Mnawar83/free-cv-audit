const { claimEmailJob, completeEmailJob } = require('./run-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const maxJobs = Math.max(1, Number(process.env.CV_EMAIL_QUEUE_BATCH_SIZE || 10));
  const maxAttempts = Math.max(1, Number(process.env.CV_EMAIL_QUEUE_MAX_ATTEMPTS || 3));
  const processed = [];
  let deadLetterCount = 0;
  let retryCount = 0;
  let completedCount = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimEmailJob();
    if (!job) break;

    try {
      const sendHandler = require('./send-cv-email').handler;
      const response = await sendHandler({
        httpMethod: 'POST',
        body: JSON.stringify({
          ...job.payload,
          forceSync: true,
        }),
      });
      const success = response.statusCode >= 200 && response.statusCode < 300;
      if (success) {
        await completeEmailJob(job.id, {
          status: 'COMPLETED',
          last_status_code: response.statusCode,
          last_response_body: response.body || '',
        });
        processed.push({ jobId: job.id, status: 'COMPLETED' });
        completedCount += 1;
      } else {
        const shouldRetry = (job.attempts || 1) < maxAttempts;
        const retryDelayMs = Math.min(60_000, Math.max(1_000, 1_000 * Math.pow(2, Math.max(0, (job.attempts || 1) - 1))));
        await completeEmailJob(job.id, {
          status: shouldRetry ? 'RETRY' : 'DEAD_LETTER',
          next_attempt_at: shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null,
          last_status_code: response.statusCode,
          last_response_body: response.body || '',
        });
        processed.push({ jobId: job.id, status: shouldRetry ? 'RETRY' : 'DEAD_LETTER' });
        if (shouldRetry) retryCount += 1;
        else deadLetterCount += 1;
      }
    } catch (error) {
      const shouldRetry = (job.attempts || 1) < maxAttempts;
      const retryDelayMs = Math.min(60_000, Math.max(1_000, 1_000 * Math.pow(2, Math.max(0, (job.attempts || 1) - 1))));
      await completeEmailJob(job.id, {
        status: shouldRetry ? 'RETRY' : 'DEAD_LETTER',
        next_attempt_at: shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null,
        last_status_code: 500,
        last_response_body: JSON.stringify({ error: error.message || 'Queue processing failed.' }),
      });
      processed.push({ jobId: job.id, status: shouldRetry ? 'RETRY' : 'DEAD_LETTER' });
      if (shouldRetry) retryCount += 1;
      else deadLetterCount += 1;
    }
  }

  if (deadLetterCount > 0) {
    console.warn('CV email queue dead-letter entries created.', { deadLetterCount, maxJobs, maxAttempts });
  }
  console.info('CV email queue batch processed.', {
    processed: processed.length,
    completedCount,
    retryCount,
    deadLetterCount,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, processed }),
  };
};
