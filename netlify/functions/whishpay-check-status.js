const {
  WHISHPAY_CURRENCY,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayStatusUrl,
} = require('./whishpay-utils');
const {
  createFulfillment,
  createFulfillmentAccessToken,
  enqueueFulfillmentJob,
  getFulfillmentByProviderOrderId,
  markPaymentEventProcessed,
  updateFulfillment,
} = require('./run-store');
const { triggerFulfillmentQueueProcessing } = require('./queue-trigger');
const { hasSessionSecretConfigured, createFulfillmentSessionCookie } = require('./fulfillment-auth');

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    assertWhishPayConfigured();
    const payload = JSON.parse(event.body || '{}');
    const currency = payload.currency || WHISHPAY_CURRENCY;
    const externalId = String(payload.externalId || '').trim();
    const runId = String(payload.runId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const requestedFulfillmentId = String(payload.fulfillmentId || '').trim();

    if (!externalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'externalId is required.' }) };
    }

    const response = await fetch(getWhishPayStatusUrl(), {
      method: 'POST',
      headers: getWhishPayHeaders(),
      body: JSON.stringify({ currency, externalId }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Whish Pay status check failed.', details: responseText }),
      };
    }

    let data = {};
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      data = { raw: responseText };
    }

    if (data?.status !== true) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Whish Pay status check failed.',
          details: data?.dialog || data?.code || data,
        }),
      };
    }

    const collectStatus = data?.data?.collectStatus;
    const normalizedCollectStatus = String(collectStatus || '').toLowerCase();
    const isPaidStatus = ['paid', 'success', 'collected'].includes(normalizedCollectStatus);
    let fulfillment = await getFulfillmentByProviderOrderId('whishpay', String(externalId));
    let setCookie = '';

    if (isPaidStatus) {
      if (!fulfillment && runId && email) {
        const accessToken = createFulfillmentAccessToken();
        fulfillment = await createFulfillment({
          run_id: runId,
          email,
          provider: 'whishpay',
          provider_order_id: String(externalId),
          payment_status: 'PAID',
          paid_at: new Date().toISOString(),
          access_token: accessToken,
        });
        if (hasSessionSecretConfigured()) {
          setCookie = createFulfillmentSessionCookie({
            fulfillmentId: fulfillment.fulfillment_id,
            accessToken,
            expiresAt: fulfillment.access_token_expires_at,
          });
        }
      }
      if (fulfillment) {
        const fulfillmentEmail = String(fulfillment.email || email || '').trim().toLowerCase();
        const eventKey = `whishpay-status:${externalId}:${normalizedCollectStatus}`;
        const eventState = await markPaymentEventProcessed('whishpay', eventKey, JSON.stringify({ externalId, collectStatus }));
        if (!eventState?.duplicate) {
          await updateFulfillment(fulfillment.fulfillment_id, {
            payment_status: 'PAID',
            email: fulfillmentEmail || null,
            paid_at: fulfillment.paid_at || new Date().toISOString(),
          });
          if (fulfillmentEmail) {
            console.log('[payment-confirmation] whishpay payment confirmed; queueing paid fulfillment', {
              fulfillmentId: fulfillment.fulfillment_id,
            });
            await updateFulfillment(fulfillment.fulfillment_id, {
              processing_status: 'full_audit_queued',
            });
            await enqueueFulfillmentJob({
              fulfillmentId: fulfillment.fulfillment_id,
              email: fulfillmentEmail,
              name: '',
              forceSync: true,
            });
            await triggerFulfillmentQueueProcessing();
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
      },
      body: JSON.stringify({
        status: true,
        collectStatus,
        isPaidStatus,
        fulfillmentId: fulfillment?.fulfillment_id || requestedFulfillmentId || null,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay status check failed.' }),
    };
  }
};
