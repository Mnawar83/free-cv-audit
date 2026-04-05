const { handler: processQueueHandler } = require('./process-email-queue');

exports.config = {
  schedule: '*/5 * * * *',
};

exports.handler = async () =>
  processQueueHandler({
    httpMethod: 'POST',
    headers: {},
    body: '',
  });
