const {
  getUserById,
  listUserRuns,
  getUserSubscriptions,
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

function parseDateMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function buildWeeklySummary({ runs = [], subscriptions = [], workspaceMembers = [] } = {}) {
  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentRuns = runs.filter((run) => parseDateMs(run?.updated_at || run?.created_at) >= weekAgo);
  const scores = recentRuns.map((run) => Number(run?.score)).filter((v) => Number.isFinite(v));
  const weeklyHealthScore = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;

  const roleSuggestions = [];
  for (const run of runs.slice(0, 12)) {
    const audit = run?.full_audit_result;
    if (!audit || typeof audit !== 'object') continue;
    const items = []
      .concat(Array.isArray(audit.summaryRecommendations) ? audit.summaryRecommendations : [])
      .concat(Array.isArray(audit.experienceRecommendations) ? audit.experienceRecommendations : [])
      .concat(Array.isArray(audit.skillsRecommendations) ? audit.skillsRecommendations : []);
    for (const item of items) {
      const text = String(item || '').trim();
      if (!text) continue;
      roleSuggestions.push(text);
      if (roleSuggestions.length >= 3) break;
    }
    if (roleSuggestions.length >= 3) break;
  }

  const nextRenewal = subscriptions
    .map((item) => item?.next_renewal_at || item?.next_billing_at || item?.current_period_end || null)
    .find(Boolean);
  const renewalDays = nextRenewal ? Math.ceil((parseDateMs(nextRenewal) - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  return {
    weeklyHealthScore,
    completedRuns: recentRuns.filter((run) => String(run?.status || '').toUpperCase() === 'COMPLETED').length,
    roleSuggestions: roleSuggestions.length ? roleSuggestions : ['Prioritize measurable achievements aligned to your target role.'],
    workspaceNudge: (workspaceMembers || []).length < 2
      ? 'Invite a teammate to review your CV this week for higher-quality feedback.'
      : `You have ${(workspaceMembers || []).length} collaborators. Ask one to review your latest CV update.`,
    renewalRecap: Number.isFinite(renewalDays)
      ? `Renewal in ${renewalDays} day(s). Keep your momentum by shipping one measurable CV improvement this week.`
      : 'No renewal date on file. Keep iterating your CV health score weekly.',
  };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) return json(401, { error: 'No active user session.' });

  const user = await getUserById(userId);
  if (!user?.email) return json(404, { error: 'User not found.' });

  const [runs, subscriptions, workspaceMembers] = await Promise.all([
    listUserRuns(userId, 50),
    getUserSubscriptions(userId),
    listWorkspaceMembers(userId),
  ]);
  const summary = buildWeeklySummary({ runs, subscriptions, workspaceMembers });

  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return json(200, {
      ok: true,
      message: 'Weekly CV health recap generated (email disabled because RESEND_API_KEY is not configured).',
      summary,
    });
  }

  const { Resend } = require('resend');
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: process.env.RETENTION_EMAIL_FROM || 'FreeCVAudit <noreply@freecvaudit.com>',
    to: [String(user.email).trim().toLowerCase()],
    subject: `Weekly CV health score: ${summary.weeklyHealthScore}/100`,
    html: `
      <h2>Your weekly CV health recap</h2>
      <p><strong>Health score:</strong> ${summary.weeklyHealthScore}/100</p>
      <p><strong>Completed runs this week:</strong> ${summary.completedRuns}</p>
      <p><strong>Role-targeted suggestions:</strong></p>
      <ul>${summary.roleSuggestions.map((item) => `<li>${item}</li>`).join('')}</ul>
      <p><strong>Workspace nudge:</strong> ${summary.workspaceNudge}</p>
      <p><strong>Renewal reminder:</strong> ${summary.renewalRecap}</p>
    `,
  });

  return json(200, { ok: true, message: 'Weekly CV health recap emailed successfully.', summary });
};
