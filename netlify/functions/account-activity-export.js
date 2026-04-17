const {
  getUserById,
  getUserEntitlements,
  getUserSubscriptions,
  listUserRuns,
  listWorkspaceMembers,
} = require('./run-store');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

function escapeCsv(value) {
  const text = String(value ?? '');
  if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizeSubscriptionMetadata(item = {}) {
  const lastSuccessfulPaymentAt = item.last_successful_payment_at
    || item.last_payment_at
    || item.last_paid_at
    || item.paid_at
    || '';
  const nextRenewalAt = item.next_renewal_at
    || item.next_billing_at
    || item.current_period_end
    || item.renews_at
    || '';
  return { lastSuccessfulPaymentAt, nextRenewalAt };
}

function createCsv(payload) {
  const rows = [
    ['recordType', 'id', 'status', 'plan', 'provider', 'score', 'updatedAt', 'lastSuccessfulPaymentAt', 'nextRenewalAt'],
  ];

  for (const subscription of payload.subscriptions || []) {
    rows.push([
      'subscription',
      subscription.subscriptionId || '',
      subscription.status || '',
      subscription.plan || '',
      subscription.provider || '',
      '',
      subscription.updatedAt || '',
      subscription.lastSuccessfulPaymentAt || '',
      subscription.nextRenewalAt || '',
    ]);
  }

  for (const run of payload.runs || []) {
    rows.push([
      'run',
      run.runId || '',
      run.status || '',
      '',
      '',
      Number.isFinite(Number(run.score)) ? String(run.score) : '',
      run.updatedAt || '',
      '',
      '',
    ]);
  }

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No active user session.' }),
    };
  }

  const user = await getUserById(userId);
  if (!user) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'User not found.' }),
    };
  }

  const [entitlements, subscriptions, runs, workspaceMembers] = await Promise.all([
    getUserEntitlements(userId),
    getUserSubscriptions(userId),
    listUserRuns(userId, 200),
    listWorkspaceMembers(userId),
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    user: {
      userId: user.user_id,
      email: user.email,
    },
    entitlements: entitlements || null,
    workspaceMemberCount: Array.isArray(workspaceMembers) ? workspaceMembers.length : 0,
    subscriptions: (subscriptions || []).map((item) => ({
      subscriptionId: item.subscription_id,
      plan: item.plan,
      status: item.status,
      provider: item.provider,
      updatedAt: item.updated_at || item.created_at || null,
      ...normalizeSubscriptionMetadata(item),
    })),
    runs: (runs || []).map((run) => ({
      runId: run.runId || run.id,
      status: run.status,
      score: run.score,
      updatedAt: run.updated_at || run.created_at || null,
    })),
  };

  const format = String(event.queryStringParameters?.format || 'json').trim().toLowerCase();
  if (format === 'csv') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="account-activity-${user.user_id}.csv"`,
      },
      body: createCsv(payload),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="account-activity-${user.user_id}.json"`,
    },
    body: JSON.stringify({ ok: true, ...payload }),
  };
};
