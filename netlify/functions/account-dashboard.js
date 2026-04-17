const {
  getUserById,
  getUserEntitlements,
  getUserSubscriptions,
  listUserRuns,
  listWorkspaceMembers,
} = require('./run-store');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStatusFilter(value) {
  const safe = String(value || '').trim().toUpperCase();
  if (!safe || safe === 'ALL') return '';
  return safe;
}

function normalizeSubscriptionMetadata(item = {}) {
  const lastSuccessfulPaymentAt = item.last_successful_payment_at
    || item.last_payment_at
    || item.last_paid_at
    || item.paid_at
    || null;
  const nextRenewalAt = item.next_renewal_at
    || item.next_billing_at
    || item.current_period_end
    || item.renews_at
    || null;
  return { lastSuccessfulPaymentAt, nextRenewalAt };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) return json(401, { error: 'No active user session.' });

  const user = await getUserById(userId);
  if (!user) return json(404, { error: 'User not found.' });

  const [entitlements, subscriptions, recentRuns, workspaceMembers] = await Promise.all([
    getUserEntitlements(userId),
    getUserSubscriptions(userId),
    listUserRuns(userId, 10),
    listWorkspaceMembers(userId),
  ]);

  const subOffset = toInt(event.queryStringParameters?.subOffset, 0, 0, 10_000);
  const subLimit = toInt(event.queryStringParameters?.subLimit, 5, 1, 50);
  const subStatusFilter = normalizeStatusFilter(event.queryStringParameters?.subStatus);
  const runOffset = toInt(event.queryStringParameters?.runOffset, 0, 0, 10_000);
  const runLimit = toInt(event.queryStringParameters?.runLimit, 5, 1, 50);
  const runStatusFilter = normalizeStatusFilter(event.queryStringParameters?.runStatus);

  const filteredSubscriptions = subStatusFilter
    ? subscriptions.filter((item) => String(item?.status || '').toUpperCase() === subStatusFilter)
    : subscriptions;
  const filteredRuns = runStatusFilter
    ? recentRuns.filter((run) => String(run?.status || '').toUpperCase() === runStatusFilter)
    : recentRuns;

  const pagedSubscriptions = filteredSubscriptions.slice(subOffset, subOffset + subLimit);
  const pagedRuns = filteredRuns.slice(runOffset, runOffset + runLimit);

  return json(200, {
    ok: true,
    user: {
      userId: user.user_id,
      email: user.email,
      name: user.name || '',
      createdAt: user.created_at || null,
    },
    entitlements: entitlements || null,
    subscriptions: (pagedSubscriptions || []).map((item) => ({
      subscriptionId: item.subscription_id,
      plan: item.plan,
      status: item.status,
      provider: item.provider,
      updatedAt: item.updated_at || item.created_at || null,
      ...normalizeSubscriptionMetadata(item),
    })),
    recentRuns: (pagedRuns || []).map((run) => ({
      runId: run.runId || run.id,
      status: run.status,
      score: run.score,
      updatedAt: run.updated_at || run.created_at || null,
    })),
    workspace: {
      memberCount: Array.isArray(workspaceMembers) ? workspaceMembers.length : 0,
      members: (workspaceMembers || []).slice(0, 10),
    },
    pagination: {
      subscriptions: {
        offset: subOffset,
        limit: subLimit,
        total: filteredSubscriptions.length,
        nextOffset: subOffset + subLimit < filteredSubscriptions.length ? subOffset + subLimit : null,
      },
      runs: {
        offset: runOffset,
        limit: runLimit,
        total: filteredRuns.length,
        nextOffset: runOffset + runLimit < filteredRuns.length ? runOffset + runLimit : null,
      },
    },
  });
};
