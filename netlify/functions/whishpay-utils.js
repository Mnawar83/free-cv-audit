const WHISHPAY_CHANNEL = process.env.WHISHPAY_CHANNEL || '10198556';
const WHISHPAY_SECRET = process.env.WHISHPAY_SECRET || '3bb0a052adc04c96a0a846de19130f5f';
const WHISHPAY_WEBSITE_URL = process.env.WHISHPAY_WEBSITE_URL || 'https://freecvaudit.com';
const WHISHPAY_AMOUNT = process.env.WHISHPAY_AMOUNT || '1.99';
const WHISHPAY_CURRENCY = process.env.WHISHPAY_CURRENCY || 'USD';
const WHISHPAY_BASE_URL = process.env.WHISHPAY_BASE_URL || 'https://api.sandbox.whish.money/itel-service/api';
const WHISHPAY_CREATE_PATH = process.env.WHISHPAY_CREATE_PATH || '/payment/whish';
const WHISHPAY_STATUS_PATH = process.env.WHISHPAY_STATUS_PATH || '/payment/collect/status';
const WHISHPAY_USER_AGENT =
  process.env.WHISHPAY_USER_AGENT || 'Whish/1.0 (https://whish.money; support@whish.money)';

function assertWhishPayConfigured() {
  if (!WHISHPAY_CHANNEL || !WHISHPAY_SECRET) {
    const error = new Error('Whish Pay credentials are not configured.');
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
  return new URL(WHISHPAY_CREATE_PATH, WHISHPAY_BASE_URL).toString();
}

function getWhishPayStatusUrl() {
  return new URL(WHISHPAY_STATUS_PATH, WHISHPAY_BASE_URL).toString();
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
