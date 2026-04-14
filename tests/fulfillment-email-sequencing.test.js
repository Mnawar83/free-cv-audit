const assert = require('assert');
const fs = require('fs');
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
  let handler;
  const sentRunIds = [];
  clearModule('../netlify/functions/send-cv-email');
  const sendModule = require('../netlify/functions/send-cv-email');
  let forcedSendStatusByRunId = {};
  sendModule.handler = async (event) => {
    sendCount += 1;
    const payload = JSON.parse(event.body || '{}');
    const runId = payload.runId || '';
    sentRunIds.push(runId);
    const forcedStatus = forcedSendStatusByRunId[runId];
    if (forcedStatus) {
      return { statusCode: forcedStatus, body: JSON.stringify({ error: 'forced send status' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  };


  // case 0: temporarily missing original CV text should retry (not dead-letter)
  const missingCvFulfillment = await runStore.createFulfillment({
    run_id: 'seq_run_missing_cv',
    email: 'sequence@example.com',
    provider: 'paypal',
    provider_order_id: `order_missing_cv_${Date.now()}`,
    payment_status: 'PAID',
  });
  await runStore.upsertRun('seq_run_missing_cv', {
    teaser_audit_status: 'teaser_audit_ready',
  });
  await runStore.enqueueFulfillmentJob({
    fulfillmentId: missingCvFulfillment.fulfillment_id,
    email: 'sequence@example.com',
    name: 'Seq User',
    forceSync: true,
  });
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res0 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload0 = JSON.parse(res0.body || '{}');
  assert.strictEqual(payload0.processed[0].status, 'RETRY');


  // case 0b: legacy paid run without original text but with revised content should still deliver
  const legacyFulfillment = await runStore.createFulfillment({
    run_id: 'seq_run_legacy_revised_only',
    email: 'sequence@example.com',
    provider: 'paypal',
    provider_order_id: `order_legacy_${Date.now()}`,
    payment_status: 'PAID',
  });
  await runStore.upsertRun('seq_run_legacy_revised_only', {
    revised_cv_text: 'Legacy Candidate\nPROFESSIONAL EXPERIENCE\n- Delivered stable systems',
  });
  await runStore.enqueueFulfillmentJob({
    fulfillmentId: legacyFulfillment.fulfillment_id,
    email: 'sequence@example.com',
    name: 'Seq User',
    forceSync: true,
  });
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res0b = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload0b = JSON.parse(res0b.body || '{}');
  assert.strictEqual(payload0b.processed[0].status, 'COMPLETED');
  const sendCountAfterLegacyDelivery = sendCount;

  // case 1: generation hard-fails => no email
  clearModule('../netlify/functions/generate-pdf');
  const generateModule1 = require('../netlify/functions/generate-pdf');
  generateModule1.handler = async () => ({ statusCode: 500, body: JSON.stringify({ error: 'gen failed' }) });

  const runId1 = 'seq_run_fail';
  await setupPaidJob(runStore, runId1);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res1 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload1 = JSON.parse(res1.body || '{}');
  assert.strictEqual(payload1.processed[0].status, 'RETRY');
  assert.strictEqual(sendCount, sendCountAfterLegacyDelivery);

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
  assert.strictEqual(sendCount, sendCountAfterLegacyDelivery);

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
  assert.strictEqual(sendCount, sendCountAfterLegacyDelivery + 1);


  // case 3b: non-retryable email 4xx should dead-letter immediately
  forcedSendStatusByRunId = { seq_run_send_400: 400 };
  clearModule('../netlify/functions/generate-pdf');
  const generateModule3b = require('../netlify/functions/generate-pdf');
  generateModule3b.handler = async () => ({ statusCode: 200, isBase64Encoded: true, body: Buffer.from('pdf').toString('base64') });

  const runId3b = 'seq_run_send_400';
  const fulfillmentId3b = await setupPaidJob(runStore, runId3b);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res3b = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload3b = JSON.parse(res3b.body || '{}');
  assert.strictEqual(payload3b.processed[0].status, 'DEAD_LETTER');
  const state = JSON.parse(fs.readFileSync(process.env.RUN_STORE_PATH, 'utf8'));
  const failedJob = (state.fulfillmentQueue || []).find((job) => job?.payload?.fulfillmentId === fulfillmentId3b && job?.status === 'DEAD_LETTER');
  assert.ok(failedJob, 'Expected dead-letter queue job to be persisted.');
  assert.strictEqual(failedJob.last_status_code, 400);
  forcedSendStatusByRunId = {};

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
  await runStore.upsertRun('seq_run_rotated_new', {
    revised_cv_text: 'Rotated run revised CV text for sync test',
    revised_cv_structured: { fullName: 'Rotated Candidate' },
  });
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res4 = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload4 = JSON.parse(res4.body || '{}');
  assert.strictEqual(payload4.processed[0].status, 'COMPLETED');
  assert.strictEqual(payload4.processed[0].runId, 'seq_run_rotated_new');
  assert.strictEqual(sentRunIds[sentRunIds.length - 1], 'seq_run_rotated_new');
  const rotatedFulfillment = await runStore.getFulfillment(fulfillmentId4);
  assert.strictEqual(rotatedFulfillment.run_id, 'seq_run_rotated_new');
  const originalRunAfterRotation = await runStore.getRun(runId4);
  assert.ok(originalRunAfterRotation?.revised_cv_text, 'Original run should retain revised CV text for client-visible run id flows.');
  assert.strictEqual(originalRunAfterRotation?.fulfillment_rotated_run_id, 'seq_run_rotated_new');

  console.log('fulfillment email sequencing test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
