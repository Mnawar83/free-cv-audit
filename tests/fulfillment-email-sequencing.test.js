const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function setupPaidJob(runStore, runId, fulfillmentId = null) {
  await runStore.upsertRun(runId, {
    original_cv_text: 'Candidate has enough source CV content for paid fulfillment sequencing checks.',
  });
  const fulfillment = fulfillmentId
    ? await runStore.updateFulfillment(fulfillmentId, {
        payment_status: 'PAID',
        email_status: 'NOT_SENT',
      })
    : await runStore.createFulfillment({
        run_id: runId,
        email: 'sequence@example.com',
        provider: 'paypal',
        provider_order_id: `order_${Date.now()}`,
        payment_status: 'PAID',
      });
  await runStore.enqueueFulfillmentJob({
    fulfillmentId: fulfillment.fulfillment_id,
    email: 'sequence@example.com',
    name: 'Seq User',
    forceSync: true,
  });
  return fulfillment.fulfillment_id;
}

async function run() {
  setupIsolatedRunStoreEnv('fulfillment-email-sequencing.test');
  process.env.QUEUE_PROCESSOR_SECRET = 'queue-secret';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');

  let sendCount = 0;
  const sentRunIds = [];
  clearModule('../netlify/functions/send-cv-email');
  const sendModule = require('../netlify/functions/send-cv-email');
  sendModule.handler = async (event) => {
    sendCount += 1;
    const payload = JSON.parse(event.body || '{}');
    sentRunIds.push(payload.runId || '');
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  };

  // case 1: generation hard-fails => no email
  clearModule('../netlify/functions/generate-pdf');
  const generateModule1 = require('../netlify/functions/generate-pdf');
  generateModule1.handler = async () => ({ statusCode: 500, body: JSON.stringify({ error: 'gen failed' }) });

  const runId1 = 'seq_run_fail';
  await setupPaidJob(runStore, runId1);
  clearModule('../netlify/functions/process-fulfillment-queue');
  let handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res1 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload1 = JSON.parse(res1.body || '{}');
  assert.strictEqual(payload1.processed[0].status, 'RETRY');
  assert.strictEqual(sendCount, 0);

  // case 2: generation returns no final attachment payload => no email
  clearModule('../netlify/functions/generate-pdf');
  const generateModule2 = require('../netlify/functions/generate-pdf');
  generateModule2.handler = async () => ({ statusCode: 200, isBase64Encoded: false, body: '' });

  const runId2 = 'seq_run_missing_attachment';
  await setupPaidJob(runStore, runId2);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res2 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload2 = JSON.parse(res2.body || '{}');
  assert.strictEqual(payload2.processed[0].status, 'RETRY');
  assert.strictEqual(sendCount, 0);

  // case 3: generation succeeds with final attachment payload => email sends
  clearModule('../netlify/functions/generate-pdf');
  const generateModule3 = require('../netlify/functions/generate-pdf');
  generateModule3.handler = async () => ({ statusCode: 200, isBase64Encoded: true, body: Buffer.from('pdf').toString('base64') });

  const runId3 = 'seq_run_success';
  await setupPaidJob(runStore, runId3);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res3 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload3 = JSON.parse(res3.body || '{}');
  assert.strictEqual(payload3.processed[0].status, 'COMPLETED');
  assert.strictEqual(sendCount, 1);


  // case 4: generate-pdf rotates run id => queue must use new run id for send + status metadata
  clearModule('../netlify/functions/generate-pdf');
  const generateModule4 = require('../netlify/functions/generate-pdf');
  generateModule4.handler = async () => ({
    statusCode: 200,
    isBase64Encoded: true,
    body: Buffer.from('pdf').toString('base64'),
    headers: { 'x-run-id': 'seq_run_rotated_new' },
  });

  const runId4 = 'seq_run_rotated_old';
  const fulfillmentId4 = await setupPaidJob(runStore, runId4);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res4 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload4 = JSON.parse(res4.body || '{}');
  assert.strictEqual(payload4.processed[0].status, 'COMPLETED');
  assert.strictEqual(payload4.processed[0].runId, 'seq_run_rotated_new');
  assert.strictEqual(sentRunIds[sentRunIds.length - 1], 'seq_run_rotated_new');
  const rotatedFulfillment = await runStore.getFulfillment(fulfillmentId4);
  assert.strictEqual(rotatedFulfillment.run_id, 'seq_run_rotated_new');

  console.log('fulfillment email sequencing test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
