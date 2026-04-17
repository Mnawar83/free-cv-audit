const { getUserEntitlements } = require('./run-store');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) return json(401, { error: 'No active user session.' });

  const entitlements = await getUserEntitlements(userId);
  const template = String(process.env.BILLING_PORTAL_URL_TEMPLATE || '').trim();
  const returnUrl = encodeURIComponent(String(event.queryStringParameters?.returnUrl || process.env.URL || '').trim());
  const url = template
    ? template.replaceAll('{USER_ID}', encodeURIComponent(userId)).replaceAll('{RETURN_URL}', returnUrl)
    : '/';

  return json(200, { ok: true, userId, plan: entitlements?.plan || 'free', billingPortalUrl: url });
};
