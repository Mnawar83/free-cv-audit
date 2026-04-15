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
  process.env.CV_EMAIL_LINK_TTL_DAYS = '30';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  const observedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    observedLogs.push(args.map((item) => String(item)).join(' '));
    originalConsoleLog(...args);
  };

  try {
    let sendCount = 0;
    let handler;
    const sentRunIds = [];
    const findProcessedForRun = (payload, runId) =>
      Array.isArray(payload?.processed) ? payload.processed.find((entry) => entry?.runId === runId) : null;
    clearModule('../netlify/functions/send-cv-email');
    const sendModule = require('../netlify/functions/send-cv-email');
    let forcedSendStatusByRunId = {};
    sendModule.handler = async (event) => {
      sendCount += 1;
      const payload = JSON.parse(event.body || '{}');
      const runId = payload.runId || '';
      sentRunIds.push(runId);
      const forcedStatus = forcedSendStatusByRunId[runId];
      if (Array.isArray(forcedStatus) && forcedStatus.length) {
        const status = forcedStatus.shift();
        return { statusCode: status, body: JSON.stringify({ error: 'forced send status' }) };
      }
      if (forcedStatus && Number.isFinite(Number(forcedStatus))) {
        return { statusCode: Number(forcedStatus), body: JSON.stringify({ error: 'forced send status' }) };
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

  // case 0c: malformed structured artifact should fall back to revised text artifact prep and still deliver
  const malformedStructuredFulfillment = await runStore.createFulfillment({
    run_id: 'seq_run_malformed_structured',
    email: 'sequence@example.com',
    provider: 'paypal',
    provider_order_id: `order_malformed_${Date.now()}`,
    payment_status: 'PAID',
  });
  await runStore.upsertRun('seq_run_malformed_structured', {
    revised_cv_structured: {
      fullName: 'Broken Structured Candidate',
      sections: [{ heading: 'Experience', bullets: 'this-should-be-array' }],
    },
    revised_cv_text: 'Broken Structured Candidate\nEXPERIENCE\n- Reliable plain-text fallback should still deliver',
  });
  await runStore.enqueueFulfillmentJob({
    fulfillmentId: malformedStructuredFulfillment.fulfillment_id,
    email: 'sequence@example.com',
    name: 'Seq User',
    forceSync: true,
  });
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res0c = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload0c = JSON.parse(res0c.body || '{}');
  assert.strictEqual(payload0c.processed[0].status, 'COMPLETED');
  assert.strictEqual(sendCount, sendCountAfterLegacyDelivery + 1, 'Malformed structured payload should still send via text fallback.');
  const sendCountAfterStructuredFallbackDelivery = sendCount;

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
  assert.strictEqual(sendCount, sendCountAfterStructuredFallbackDelivery);

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
  assert.strictEqual(sendCount, sendCountAfterStructuredFallbackDelivery);

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
  assert.strictEqual(sendCount, sendCountAfterStructuredFallbackDelivery + 1);



    // case 3a: transient email failure should retry email without regenerating CV
  const retryRunId = 'seq_run_retry_email';
  let retryGenerateCallCount = 0;
  clearModule('../netlify/functions/generate-pdf');
  const generateModule3a = require('../netlify/functions/generate-pdf');
  generateModule3a.handler = async (event) => {
    const payload = JSON.parse(event?.body || '{}');
    if (payload?.runId === retryRunId) {
      retryGenerateCallCount += 1;
    }
    return { statusCode: 200, isBase64Encoded: true, body: Buffer.from('pdf').toString('base64') };
  };
    forcedSendStatusByRunId = { [retryRunId]: [503, 200] };
  await setupPaidJob(runStore, retryRunId);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const retryRunAfterFirstPass = await runStore.getRun(retryRunId);
  const retryArtifactTokenBeforeRetry = retryRunAfterFirstPass?.final_cv_artifact_token || null;
  const retryArtifactBefore = retryArtifactTokenBeforeRetry ? await runStore.getArtifactToken(retryArtifactTokenBeforeRetry) : null;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  let secondRetryResult = null;
  for (let attempt = 0; attempt < 3 && !secondRetryResult; attempt += 1) {
    const res3aSecond = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
    const payload3aSecond = JSON.parse(res3aSecond.body || '{}');
    secondRetryResult = findProcessedForRun(payload3aSecond, retryRunId);
    if (!secondRetryResult) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }
  assert.strictEqual(secondRetryResult?.status, 'COMPLETED');
  assert.strictEqual(retryGenerateCallCount, 1, 'CV generation should not rerun on retry when artifacts are already ready.');
  const retryRunAfterSecondPass = await runStore.getRun(retryRunId);
  assert.strictEqual(
    retryRunAfterSecondPass?.final_cv_artifact_token,
    retryArtifactTokenBeforeRetry,
    'Retry should reuse existing final artifact token when still valid.',
  );
  const retryArtifactAfter = retryArtifactTokenBeforeRetry ? await runStore.getArtifactToken(retryArtifactTokenBeforeRetry) : null;
  assert.strictEqual(
    retryArtifactAfter?.updated_at,
    retryArtifactBefore?.updated_at,
    'Artifact token should not be rewritten on retry when payload is unchanged.',
  );
  forcedSendStatusByRunId = {};

  // case 3b: transient email 404 should retry (durable-store propagation race) and then complete
  const retry404RunId = 'seq_run_retry_email_404';
  clearModule('../netlify/functions/generate-pdf');
  const generateModule3b = require('../netlify/functions/generate-pdf');
  generateModule3b.handler = async () => ({ statusCode: 200, isBase64Encoded: true, body: Buffer.from('pdf').toString('base64') });
  forcedSendStatusByRunId = { [retry404RunId]: [404, 200] };
  await setupPaidJob(runStore, retry404RunId);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  let retry404Result = null;
  for (let attempt = 0; attempt < 3 && !retry404Result; attempt += 1) {
    const res3b = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
    const payload3b = JSON.parse(res3b.body || '{}');
    retry404Result = findProcessedForRun(payload3b, retry404RunId);
    if (!retry404Result) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }
  assert.strictEqual(retry404Result?.status, 'COMPLETED');
  forcedSendStatusByRunId = {};

  // case 3c: non-retryable email 4xx should dead-letter immediately
  forcedSendStatusByRunId = { seq_run_send_400: 400 };
  clearModule('../netlify/functions/generate-pdf');
  const generateModule3c = require('../netlify/functions/generate-pdf');
  generateModule3c.handler = async () => ({ statusCode: 200, isBase64Encoded: true, body: Buffer.from('pdf').toString('base64') });

  const runId3b = 'seq_run_send_400';
  const fulfillmentId3b = await setupPaidJob(runStore, runId3b);
  clearModule('../netlify/functions/process-fulfillment-queue');
  handler = require('../netlify/functions/process-fulfillment-queue').handler;
  const res3c = await handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer queue-secret' } });
  const payload3c = JSON.parse(res3c.body || '{}');
  assert.strictEqual(payload3c.processed[0].status, 'DEAD_LETTER');
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

    assert.ok(observedLogs.some((entry) => entry.includes('[fulfillment][queue] claimed')), 'Queue claim timing log should exist.');
    assert.ok(observedLogs.some((entry) => entry.includes('[fulfillment][audit] start')), 'Audit start timing log should exist.');
    assert.ok(observedLogs.some((entry) => entry.includes('[fulfillment][cv-generation] start')), 'CV generation start timing log should exist.');
    assert.ok(observedLogs.some((entry) => entry.includes('[fulfillment][artifact] build-complete')), 'Artifact build timing log should exist.');
    assert.ok(observedLogs.some((entry) => entry.includes('[fulfillment][email] send-complete')), 'Email send timing log should exist.');

    console.log('fulfillment email sequencing test passed');
  } finally {
    console.log = originalConsoleLog;
    delete process.env.CV_EMAIL_LINK_TTL_DAYS;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
