const { handler: processFulfillmentQueueHandler } = require('./process-fulfillment-queue');

exports.config = {
  schedule: '*/2 * * * *',
};

exports.handler = async () =>
  processFulfillmentQueueHandler({
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${String(process.env.QUEUE_PROCESSOR_SECRET || '').trim()}` },
    body: '',
  });
