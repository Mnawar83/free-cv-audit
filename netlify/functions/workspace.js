const { badRequest, parseJsonBody } = require('./http-400');
const {
  getUserEntitlements,
  listWorkspaceMembers,
  removeWorkspaceMember,
  upsertWorkspaceMember,
} = require('./run-store');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function requireSessionUser(event) {
  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) return { ok: false, response: json(401, { error: 'No active user session.' }) };
  return { ok: true, userId };
}

async function requireTeamEntitlement(userId) {
  const entitlements = await getUserEntitlements(userId);
  if (!entitlements?.canUseTeamWorkspace) {
    return { ok: false, response: json(402, { error: 'Team workspace requires Team plan.', code: 'TEAM_PLAN_REQUIRED' }) };
  }
  return { ok: true, entitlements };
}

exports.handler = async (event) => {
  const functionName = 'workspace';
  const route = '/.netlify/functions/workspace';
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  const session = requireSessionUser(event);
  if (!session.ok) return session.response;
  const userId = session.userId;

  const teamAccess = await requireTeamEntitlement(userId);
  if (!teamAccess.ok) return teamAccess.response;

  if (event.httpMethod === 'GET') {
    const members = await listWorkspaceMembers(userId);
    return json(200, { ok: true, userId, members });
  }

  if (event.httpMethod === 'DELETE') {
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const memberEmail = String(parsed.body?.email || '').trim().toLowerCase();
    if (!memberEmail) {
      return badRequest({ event, functionName, route, message: 'Missing email.', payload: parsed.body, missingFields: ['email'] });
    }
    const removed = await removeWorkspaceMember(userId, memberEmail);
    const members = await listWorkspaceMembers(userId);
    return json(200, { ok: true, removed, members });
  }

  if (event.httpMethod === 'POST' || event.httpMethod === 'PATCH') {
    const parsed = parseJsonBody(event, { functionName, route });
    if (!parsed.ok) return parsed.response;
    const body = parsed.body || {};
    const memberEmail = String(body.email || '').trim().toLowerCase();
    if (!memberEmail) {
      return badRequest({ event, functionName, route, message: 'Missing email.', payload: body, missingFields: ['email'] });
    }
    const role = String(body.role || 'member').trim().toLowerCase();
    const status = String(body.status || 'INVITED').trim().toUpperCase();
    await upsertWorkspaceMember(userId, memberEmail, role, status);
    const members = await listWorkspaceMembers(userId);
    return json(200, { ok: true, members });
  }

  return json(405, { error: 'Method Not Allowed' });
};
