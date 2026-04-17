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

  return json(200, {
    ok: true,
    user: {
      userId: user.user_id,
      email: user.email,
      name: user.name || '',
      createdAt: user.created_at || null,
    },
    entitlements: entitlements || null,
    subscriptions: (subscriptions || []).slice(0, 5).map((item) => ({
      subscriptionId: item.subscription_id,
      plan: item.plan,
      status: item.status,
      provider: item.provider,
      updatedAt: item.updated_at || item.created_at || null,
    })),
    recentRuns: (recentRuns || []).map((run) => ({
      runId: run.runId || run.id,
      status: run.status,
      score: run.score,
      updatedAt: run.updated_at || run.created_at || null,
    })),
    workspace: {
      memberCount: Array.isArray(workspaceMembers) ? workspaceMembers.length : 0,
      members: (workspaceMembers || []).slice(0, 10),
    },
  });
};
