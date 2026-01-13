const PAYPAL_CURRENCY = 'USD';
const PAYPAL_AMOUNT = '1.99';

function getPayPalBaseUrl() {
  if (process.env.PAYPAL_BASE_URL) {
    return process.env.PAYPAL_BASE_URL;
  }
  return process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
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

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorData = await response.text();
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
  assertPayPalConfigured,
  getPayPalAccessToken,
};
