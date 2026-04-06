const { handler: processQueueHandler } = require('./process-email-queue');
exports.config = { schedule: '*/5 * * * *' };
exports.handler = async (event) =>
  processQueueHandler({
    ...event,
    httpMethod: 'POST',
    headers: { ...(event || {}).headers, Authorization: `Bearer ${String(process.env.QUEUE_PROCESSOR_SECRET || '').trim()}` },
    body: '',
  });
