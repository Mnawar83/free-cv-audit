const assert = require('assert');
const { setupIsolatedRunStoreEnv } = require('./helpers/test-env');

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function toCookieHeader(setCookieValue = '') {
  return String(setCookieValue || '').split(';')[0];
}

async function run() {
  setupIsolatedRunStoreEnv('fulfillment-functions.test');
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.URL = 'https://app.freecvaudit.com';
  process.env.FULFILLMENT_SESSION_SECRET = 'test-fulfillment-session-secret';
  process.env.FULFILLMENT_LINK_SEND_CODE = 'false';
  process.env.FULFILLMENT_LINK_RETURN_DEBUG_CODE = 'true';

  clearModule('../netlify/functions/run-store');
  const runStore = require('../netlify/functions/run-store');
  clearModule('../netlify/functions/fulfillment-auth');
  const { createFulfillmentSessionCookie } = require('../netlify/functions/fulfillment-auth');
  const runId = 'fulfillment_test_run';
  await runStore.upsertRun(runId, {
    revised_cv_text: 'Candidate\nEXPERIENCE\n- Built robust systems',
  });

  const fulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'status@example.com',
    provider: 'paypal',
    provider_order_id: 'order_status_1',
    payment_status: 'PAID',
    access_token: 'fulfillment-access-token',
  });
  let sessionCookieHeader = toCookieHeader(
    createFulfillmentSessionCookie({
      fulfillmentId: fulfillment.fulfillment_id,
      accessToken: 'fulfillment-access-token',
      expiresAt: fulfillment.access_token_expires_at,
    }),
  );

  clearModule('../netlify/functions/fulfillment-link-session');
  const linkSessionHandler = require('../netlify/functions/fulfillment-link-session').handler;
  const linkSessionChallenge = await linkSessionHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
      email: 'status@example.com',
    }),
  });
  assert.strictEqual(linkSessionChallenge.statusCode, 200);
  const challengePayload = JSON.parse(linkSessionChallenge.body || '{}');
  assert.ok(challengePayload.debugCode);
  const linkedSession = await linkSessionHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
      email: 'status@example.com',
      code: challengePayload.debugCode,
    }),
  });
  assert.strictEqual(linkedSession.statusCode, 200);
  sessionCookieHeader = toCookieHeader(linkedSession.headers?.['Set-Cookie']) || sessionCookieHeader;

  clearModule('../netlify/functions/fulfillment-status');
  const statusHandler = require('../netlify/functions/fulfillment-status').handler;
  const statusResponse = await statusHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, cookie: sessionCookieHeader },
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
  });
  assert.strictEqual(statusResponse.statusCode, 200);
  const statusPayload = JSON.parse(statusResponse.body || '{}');
  assert.strictEqual(statusPayload.paymentStatus, 'PAID');
  assert.ok(!Object.prototype.hasOwnProperty.call(statusPayload, 'runId'));

  process.env.FULFILLMENT_STATUS_RATE_LIMIT_MAX = '1';
  process.env.FULFILLMENT_STATUS_RATE_LIMIT_WINDOW_MS = '60000';
  const statusRateLimited = await statusHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
    headers: { origin: process.env.URL, 'x-forwarded-for': '10.10.10.10', cookie: sessionCookieHeader },
  });
  const statusRateLimitedSecond = await statusHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
    headers: { origin: process.env.URL, 'x-forwarded-for': '10.10.10.10', cookie: sessionCookieHeader },
  });
  assert.strictEqual(statusRateLimited.statusCode, 200);
  assert.strictEqual(statusRateLimitedSecond.statusCode, 429);

  let resendCallCount = 0;
  global.fetch = async () => {
    resendCallCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: `email_${resendCallCount}` }),
    };
  };

  clearModule('../netlify/functions/send-cv-email');
  clearModule('../netlify/functions/fulfillment-resend-email');
  const resendHandler = require('../netlify/functions/fulfillment-resend-email').handler;
  const resendResponse = await resendHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, cookie: sessionCookieHeader },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
      email: 'status@example.com',
      name: 'Status User',
      forceSync: true,
    }),
  });
  assert.strictEqual(resendResponse.statusCode, 200);
  assert.strictEqual(resendCallCount, 1);
  sessionCookieHeader = toCookieHeader(resendResponse.headers?.['Set-Cookie']);
  assert.ok(sessionCookieHeader);

  process.env.FULFILLMENT_RESEND_RATE_LIMIT_MAX = '1';
  process.env.FULFILLMENT_RESEND_RATE_LIMIT_WINDOW_MS = '60000';
  const resendRateLimited = await resendHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '11.11.11.11', cookie: sessionCookieHeader },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
      email: 'status@example.com',
      name: 'Status User',
      forceSync: true,
    }),
  });
  const resendRateLimitedSecond = await resendHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '11.11.11.11', cookie: sessionCookieHeader },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
      email: 'status@example.com',
      name: 'Status User',
      forceSync: true,
    }),
  });
  assert.strictEqual(resendRateLimited.statusCode, 200);
  assert.strictEqual(resendRateLimitedSecond.statusCode, 429);
  sessionCookieHeader = toCookieHeader(resendRateLimited.headers?.['Set-Cookie']) || sessionCookieHeader;

  const resendWrongEmail = await resendHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '11.11.11.12', cookie: sessionCookieHeader },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
      email: 'other-person@example.com',
      name: 'Wrong Person',
      forceSync: true,
    }),
  });
  assert.strictEqual(resendWrongEmail.statusCode, 403);

  clearModule('../netlify/functions/fulfillment-reissue-download');
  const reissueHandler = require('../netlify/functions/fulfillment-reissue-download').handler;
  const reissueResponse = await reissueHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '12.12.12.12' },
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
  });
  assert.strictEqual(reissueResponse.statusCode, 403);
  const reissueAuthorizedResponse = await reissueHandler({
    httpMethod: 'POST',
    headers: { origin: process.env.URL, 'x-forwarded-for': '12.12.12.12', cookie: sessionCookieHeader },
    body: JSON.stringify({
      fulfillmentId: fulfillment.fulfillment_id,
    }),
  });
  assert.strictEqual(reissueAuthorizedResponse.statusCode, 200);
  const reissuePayload = JSON.parse(reissueAuthorizedResponse.body || '{}');
  assert.ok(String(reissuePayload.downloadUrl || '').includes('cv-email-download?token='));
  sessionCookieHeader = toCookieHeader(reissueAuthorizedResponse.headers?.['Set-Cookie']) || sessionCookieHeader;

  const unauthorizedStatus = await statusHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
    headers: { origin: process.env.URL, 'x-forwarded-for': '13.13.13.13', cookie: 'bad_cookie=1' },
  });
  assert.strictEqual(unauthorizedStatus.statusCode, 403);

  const authorizedAfterRotation = await statusHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
    headers: { origin: process.env.URL, 'x-forwarded-for': '13.13.13.14', cookie: sessionCookieHeader },
  });
  assert.strictEqual(authorizedAfterRotation.statusCode, 200);

  await runStore.updateFulfillment(fulfillment.fulfillment_id, {
    access_token_expires_at: null,
  });
  const statusWithoutExpiry = await statusHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ fulfillmentId: fulfillment.fulfillment_id }),
    headers: { origin: process.env.URL, 'x-forwarded-for': '13.13.13.15', cookie: sessionCookieHeader },
  });
  assert.strictEqual(statusWithoutExpiry.statusCode, 403);
  await runStore.updateFulfillment(fulfillment.fulfillment_id, {
    access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  const expiredTokenFulfillment = await runStore.createFulfillment({
    run_id: runId,
    email: 'expired@example.com',
    provider: 'paypal',
    provider_order_id: 'order_status_expired',
    payment_status: 'PAID',
    access_token: 'expired-token',
    access_token_expires_at: new Date(Date.now() - 1_000).toISOString(),
  });
  const expiredStatus = await statusHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      fulfillmentId: expiredTokenFulfillment.fulfillment_id,
    }),
    headers: {
      origin: process.env.URL,
      cookie: toCookieHeader(
        createFulfillmentSessionCookie({
          fulfillmentId: expiredTokenFulfillment.fulfillment_id,
          accessToken: 'expired-token',
          expiresAt: expiredTokenFulfillment.access_token_expires_at,
        }),
      ),
    },
  });
  assert.strictEqual(expiredStatus.statusCode, 403);

  const pending = await runStore.createFulfillment({
    run_id: runId,
    email: 'pending@example.com',
    provider: 'paypal',
    provider_order_id: 'order_status_2',
    payment_status: 'PENDING',
    access_token: 'pending-fulfillment-token',
  });
  const pendingResponse = await resendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      fulfillmentId: pending.fulfillment_id,
      email: 'pending@example.com',
      name: 'Pending User',
      forceSync: true,
    }),
    headers: {
      origin: process.env.URL,
      cookie: toCookieHeader(
        createFulfillmentSessionCookie({
          fulfillmentId: pending.fulfillment_id,
          accessToken: 'pending-fulfillment-token',
          expiresAt: pending.access_token_expires_at,
        }),
      ),
    },
  });
  assert.strictEqual(pendingResponse.statusCode, 409);

  console.log('fulfillment functions test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
