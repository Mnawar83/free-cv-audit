const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');
const crypto = require('crypto');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function run() {
  setupIsolatedRunStoreEnv('resend-email-webhook.test');
  process.env.RESEND_WEBHOOK_SECRET = 'super-secret';
  process.env.RESEND_WEBHOOK_STRICT_SIGNATURE = 'false';
  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  await runStore.upsertEmailDelivery('delivery:test-1', {
    provider: 'resend',
    provider_email_id: 'email_123',
    status: 'SENT',
  });

  clearModule('../netlify/functions/resend-email-webhook');
  const { handler } = require('../netlify/functions/resend-email-webhook');

  const unauthorized = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ type: 'email.delivered', data: { id: 'email_123' } }),
  });
  assert.strictEqual(unauthorized.statusCode, 401);

  const delivered = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'super-secret' },
    body: JSON.stringify({ type: 'email.delivered', data: { id: 'email_123' } }),
  });
  assert.strictEqual(delivered.statusCode, 200);

  const updated = await runStore.findEmailDeliveryByProviderId('email_123');
  assert.ok(updated);
  assert.strictEqual(updated.status, 'DELIVERED');

  const created = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'super-secret' },
    body: JSON.stringify({ type: 'email.bounced', data: { id: 'email_999' } }),
  });
  assert.strictEqual(created.statusCode, 200);
  const createdDelivery = await runStore.findEmailDeliveryByProviderId('email_999');
  assert.ok(createdDelivery);
  assert.strictEqual(createdDelivery.status, 'BOUNCED');

  const signedBody = JSON.stringify({ id: 'evt_abc', type: 'email.opened', data: { id: 'email_123' } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', 'super-secret').update(`${timestamp}.${signedBody}`, 'utf8').digest('hex');
  const signedResponse = await handler({
    httpMethod: 'POST',
    headers: { 'x-resend-signature': `sha256=${signature}`, 'x-resend-timestamp': String(timestamp) },
    body: signedBody,
  });
  assert.strictEqual(signedResponse.statusCode, 200);

  const duplicateResponse = await handler({
    httpMethod: 'POST',
    headers: { 'x-resend-signature': `sha256=${signature}`, 'x-resend-timestamp': String(timestamp) },
    body: signedBody,
  });
  assert.strictEqual(duplicateResponse.statusCode, 200);
  const duplicatePayload = JSON.parse(duplicateResponse.body || '{}');
  assert.strictEqual(duplicatePayload.duplicate, true);

  const staleTimestamp = timestamp - 3600;
  const staleSignature = crypto
    .createHmac('sha256', 'super-secret')
    .update(`${staleTimestamp}.${signedBody}`, 'utf8')
    .digest('hex');
  const staleResponse = await handler({
    httpMethod: 'POST',
    headers: { 'x-resend-signature': `sha256=${staleSignature}`, 'x-resend-timestamp': String(staleTimestamp) },
    body: signedBody,
  });
  assert.strictEqual(staleResponse.statusCode, 401);

  process.env.RESEND_WEBHOOK_STRICT_SIGNATURE = 'true';
  const strictLegacyOnly = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'super-secret' },
    body: JSON.stringify({ type: 'email.delivered', data: { id: 'email_strict' } }),
  });
  assert.strictEqual(strictLegacyOnly.statusCode, 401);

  console.log('resend-email-webhook test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
