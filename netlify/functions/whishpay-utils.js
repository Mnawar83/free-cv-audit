const WHISHPAY_CHANNEL = process.env.WHISHPAY_CHANNEL;
const WHISHPAY_SECRET = process.env.WHISHPAY_SECRET;
const WHISHPAY_WEBSITE_URL = process.env.WHISHPAY_WEBSITE_URL;
const WHISHPAY_AMOUNT = process.env.WHISHPAY_AMOUNT || '1.99';
const WHISHPAY_CURRENCY = process.env.WHISHPAY_CURRENCY || 'USD';
const WHISHPAY_BASE_URL = process.env.WHISHPAY_BASE_URL;
const WHISHPAY_CREATE_PATH = process.env.WHISHPAY_CREATE_PATH || '/payment/whish';
const WHISHPAY_STATUS_PATH = process.env.WHISHPAY_STATUS_PATH || '/payment/collect/status';
const WHISHPAY_USER_AGENT =
  process.env.WHISHPAY_USER_AGENT || 'Whish/1.0 (https://whish.money; support@whish.money)';

function assertWhishPayConfigured() {
  if (!WHISHPAY_CHANNEL || !WHISHPAY_SECRET || !WHISHPAY_WEBSITE_URL || !WHISHPAY_BASE_URL) {
    const error = new Error(
      'Whish Pay env vars are required: WHISHPAY_CHANNEL, WHISHPAY_SECRET, WHISHPAY_WEBSITE_URL, WHISHPAY_BASE_URL.',
    );
    error.statusCode = 500;
    throw error;
  }

  return {
    channel: WHISHPAY_CHANNEL,
    secret: WHISHPAY_SECRET,
    websiteUrl: WHISHPAY_WEBSITE_URL,
  };
}

function getWhishPayHeaders() {
  const { channel, secret } = assertWhishPayConfigured();
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    channel,
    secret,
    websiteUrl: WHISHPAY_WEBSITE_URL,
    'User-Agent': WHISHPAY_USER_AGENT,
  };
}

function getWhishPayCreateUrl() {
  const baseUrl = WHISHPAY_BASE_URL.endsWith('/') ? WHISHPAY_BASE_URL : WHISHPAY_BASE_URL + '/';
  const path = WHISHPAY_CREATE_PATH.startsWith('/') ? WHISHPAY_CREATE_PATH.slice(1) : WHISHPAY_CREATE_PATH;
  return new URL(path, baseUrl).toString();
}

function getWhishPayStatusUrl() {
  const baseUrl = WHISHPAY_BASE_URL.endsWith('/') ? WHISHPAY_BASE_URL : WHISHPAY_BASE_URL + '/';
  const path = WHISHPAY_STATUS_PATH.startsWith('/') ? WHISHPAY_STATUS_PATH.slice(1) : WHISHPAY_STATUS_PATH;
  return new URL(path, baseUrl).toString();
}

module.exports = {
  WHISHPAY_AMOUNT,
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
  getWhishPayHeaders,
  getWhishPayCreateUrl,
  getWhishPayStatusUrl,
};
