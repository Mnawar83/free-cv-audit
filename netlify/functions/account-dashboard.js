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

function parseDateMs(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMonthKey(dateLike) {
  const date = new Date(dateLike || Date.now());
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeWeaknessToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectWeaknesses(run = {}) {
  const fullAudit = run?.full_audit_result && typeof run.full_audit_result === 'object' ? run.full_audit_result : null;
  if (!fullAudit) return [];
  const findings = []
    .concat(Array.isArray(fullAudit.auditFindings) ? fullAudit.auditFindings : [])
    .concat(Array.isArray(fullAudit.improvementNotes) ? fullAudit.improvementNotes : [])
    .concat(Array.isArray(fullAudit.atsKeywordSuggestions) ? fullAudit.atsKeywordSuggestions : []);
  return findings
    .map(normalizeWeaknessToken)
    .filter(Boolean);
}

function buildDashboardInsights({ runs = [], subscriptions = [], workspaceMembers = [] } = {}) {
  const now = new Date();
  const nowMs = now.getTime();
  const currentMonth = getMonthKey(nowMs);
  const previousMonth = getMonthKey(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const completedLike = new Set(['COMPLETED', 'CV_READY', 'EMAIL_SENT', 'FULL_AUDIT_COMPLETED']);
  const passThreshold = Math.max(50, Number(process.env.DASHBOARD_PASS_THRESHOLD || 75));
  const minutesSavedPerRun = Math.max(5, Number(process.env.DASHBOARD_MINUTES_SAVED_PER_RUN || 18));

  const monthBuckets = {
    [currentMonth]: { completed: 0, passed: 0, total: 0 },
    [previousMonth]: { completed: 0, passed: 0, total: 0 },
  };

  const weaknessCounts = new Map();
  for (const run of runs) {
    const updatedMs = parseDateMs(run?.updated_at || run?.created_at);
    const status = String(run?.status || '').trim().toUpperCase();
    const score = Number(run?.score);
    const monthKey = getMonthKey(updatedMs || nowMs);
    if (!monthBuckets[monthKey]) {
      monthBuckets[monthKey] = { completed: 0, passed: 0, total: 0 };
    }
    monthBuckets[monthKey].total += 1;
    if (completedLike.has(status)) monthBuckets[monthKey].completed += 1;
    if (Number.isFinite(score) && score >= passThreshold) monthBuckets[monthKey].passed += 1;

    for (const weakness of collectWeaknesses(run)) {
      weaknessCounts.set(weakness, (weaknessCounts.get(weakness) || 0) + 1);
    }
  }

  const currentStats = monthBuckets[currentMonth] || { completed: 0, passed: 0, total: 0 };
  const previousStats = monthBuckets[previousMonth] || { completed: 0, passed: 0, total: 0 };
  const renewalCandidates = subscriptions
    .map((item) => normalizeSubscriptionMetadata(item))
    .filter((item) => item.nextRenewalAt)
    .map((item) => ({ ...item, renewalMs: parseDateMs(item.nextRenewalAt) }))
    .filter((item) => item.renewalMs > 0)
    .sort((a, b) => a.renewalMs - b.renewalMs);
  const nextRenewal = renewalCandidates[0] || null;
  const renewalDays = nextRenewal ? Math.ceil((nextRenewal.renewalMs - nowMs) / (24 * 60 * 60 * 1000)) : null;
  const hasPastDue = subscriptions.some((item) => String(item?.status || '').trim().toUpperCase() === 'PAST_DUE');
  const riskLevel = hasPastDue ? 'HIGH' : (typeof renewalDays === 'number' && renewalDays <= 7 ? 'MEDIUM' : 'LOW');

  const teamSnapshot = {
    totalMembers: Array.isArray(workspaceMembers) ? workspaceMembers.length : 0,
    invited: (workspaceMembers || []).filter((item) => String(item?.status || '').trim().toUpperCase() === 'INVITED').length,
    active: (workspaceMembers || []).filter((item) => String(item?.status || '').trim().toUpperCase() === 'ACTIVE').length,
    suspended: (workspaceMembers || []).filter((item) => String(item?.status || '').trim().toUpperCase() === 'SUSPENDED').length,
  };

  const mostCommonWeaknesses = Array.from(weaknessCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  return {
    timeSavedThisMonthMinutes: currentStats.completed * minutesSavedPerRun,
    timeSavedThisMonthHours: Number(((currentStats.completed * minutesSavedPerRun) / 60).toFixed(1)),
    completedRunsTrend: {
      month: currentMonth,
      completed: currentStats.completed,
      previousMonth,
      previousCompleted: previousStats.completed,
      delta: currentStats.completed - previousStats.completed,
    },
    passRateTrend: {
      passThreshold,
      month: currentMonth,
      passed: currentStats.passed,
      total: currentStats.total,
      rate: currentStats.total ? Number((currentStats.passed / currentStats.total).toFixed(2)) : 0,
      previousMonth,
      previousPassed: previousStats.passed,
      previousTotal: previousStats.total,
      previousRate: previousStats.total ? Number((previousStats.passed / previousStats.total).toFixed(2)) : 0,
    },
    mostCommonWeaknesses,
    teamActivity: teamSnapshot,
    alerts: {
      nextRenewalAt: nextRenewal?.nextRenewalAt || null,
      renewalDays,
      hasPastDue,
      riskLevel,
    },
  };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (_ignored) {}

  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const userId = String(getUserIdFromSessionCookie(event) || '').trim();
  if (!userId) return json(401, { error: 'No active user session.' });

  const user = await getUserById(userId);
  if (!user) return json(404, { error: 'User not found.' });

  const [entitlements, subscriptions, allRuns, workspaceMembers] = await Promise.all([
    getUserEntitlements(userId),
    getUserSubscriptions(userId),
    listUserRuns(userId, 100),
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
    ? allRuns.filter((run) => String(run?.status || '').toUpperCase() === runStatusFilter)
    : allRuns;

  const pagedSubscriptions = filteredSubscriptions.slice(subOffset, subOffset + subLimit);
  const pagedRuns = filteredRuns.slice(runOffset, runOffset + runLimit);
  const insights = buildDashboardInsights({ runs: allRuns, subscriptions, workspaceMembers });

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
    insights,
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
