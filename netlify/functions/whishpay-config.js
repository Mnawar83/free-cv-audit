const {
  WHISHPAY_AMOUNT,
  WHISHPAY_CURRENCY,
  WHISHPAY_WEBSITE_URL,
  assertWhishPayConfigured,
} = require('./whishpay-utils');

exports.handler = async () => {
  try {
    assertWhishPayConfigured();
    return {
      statusCode: 200,
      body: JSON.stringify({
        amount: WHISHPAY_AMOUNT,
        currency: WHISHPAY_CURRENCY,
        websiteUrl: WHISHPAY_WEBSITE_URL,
      }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({ error: error.message || 'Whish Pay configuration failed.' }),
    };
  }
};
