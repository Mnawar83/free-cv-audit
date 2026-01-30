const PAYPAL_CURRENCY = process.env.PAYPAL_CURRENCY || 'USD';
const PAYPAL_AMOUNT = process.env.PAYPAL_AMOUNT || '1.99';
const PAYPAL_BUYER_COUNTRY = process.env.PAYPAL_BUYER_COUNTRY || '';

function getPayPalBaseUrl() {
  return process.env.PAYPAL_BASE_URL || 'https://api-m.paypal.com';
}

function getPayPalEnvironment() {
  const env = (process.env.PAYPAL_ENV || '').toLowerCase();
  if (env === 'sandbox' || env === 'live') {
    return env;
  }
  const baseUrl = getPayPalBaseUrl();
  if (baseUrl.includes('sandbox')) {
    return 'sandbox';
  }
  return 'live';
}

function getPayPalSdkBaseUrl() {
  return getPayPalEnvironment() === 'sandbox'
    ? 'https://www.sandbox.paypal.com/sdk/js'
    : 'https://www.paypal.com/sdk/js';
}

function assertPayPalConfigured() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error('PayPal credentials are not configured.');
    error.statusCode = 500;
    throw error;
  }
  return { clientId, clientSecret };
}

async function getPayPalAccessToken() {
  const { clientId, clientSecret } = assertPayPalConfigured();
  const baseUrl = getPayPalBaseUrl();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    let errorData = await response.text();
    try {
      errorData = JSON.parse(errorData);
    } catch (parseError) {
      // Keep text response for troubleshooting.
    }
    const error = new Error('Unable to authenticate with PayPal.');
    error.details = errorData;
    error.statusCode = 502;
    throw error;
  }

  const data = await response.json();
  return { accessToken: data.access_token, baseUrl };
}

module.exports = {
  PAYPAL_AMOUNT,
  PAYPAL_CURRENCY,
  PAYPAL_BUYER_COUNTRY,
  assertPayPalConfigured,
  getPayPalAccessToken,
  getPayPalEnvironment,
  getPayPalSdkBaseUrl,
};
