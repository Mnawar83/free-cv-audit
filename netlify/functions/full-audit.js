const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
const { getRun, upsertRun } = require('./run-store');

const FULL_AUDIT_PROMPT = `You are a senior ATS CV auditor and rewrite strategist.
Return strict JSON only with this schema:
{
  "auditFindings": ["string"],
  "improvementNotes": ["string"],
  "atsKeywordSuggestions": ["string"],
  "summaryRecommendations": ["string"],
  "experienceRecommendations": ["string"],
  "skillsRecommendations": ["string"]
}
Use only CV facts from the input. No markdown. No prose outside JSON.`;

function parseAuditJson(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    const ensure = (key) => Array.isArray(parsed?.[key]) ? parsed[key].map((v) => String(v || '').trim()).filter(Boolean) : [];
    return {
      auditFindings: ensure('auditFindings'),
      improvementNotes: ensure('improvementNotes'),
      atsKeywordSuggestions: ensure('atsKeywordSuggestions'),
      summaryRecommendations: ensure('summaryRecommendations'),
      experienceRecommendations: ensure('experienceRecommendations'),
      skillsRecommendations: ensure('skillsRecommendations'),
    };
  } catch (_error) {
    return null;
  }
}

function fallbackAudit(cvText = '') {
  const compact = String(cvText || '').slice(0, 4000);
  return {
    auditFindings: ['The paid audit fallback was used due to model unavailability.'],
    improvementNotes: ['Clarify business impact in each role and prioritize quantified outcomes.'],
    atsKeywordSuggestions: ['project management', 'stakeholder communication', 'process improvement'],
    summaryRecommendations: ['Lead with role target, years of experience, and strongest domain expertise.'],
    experienceRecommendations: ['Use action-result bullets and remove vague responsibility-only statements.'],
    skillsRecommendations: compact ? ['Keep only role-relevant skills and remove duplicates.'] : ['Provide a concise, role-aligned skills section.'],
  };
}

async function runFullAudit(runId, cvText, teaserHints = '') {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return fallbackAudit(cvText);
  const modelTimeoutMs = Math.max(1_000, Number(process.env.FULL_AUDIT_MODEL_TIMEOUT_MS || 12_000));

  const candidateModels = getGoogleAiCandidateModels();
  for (const model of candidateModels) {
    const requestController = new AbortController();
    const timeoutHandle = setTimeout(() => requestController.abort(), modelTimeoutMs);
    try {
      const apiUrl = buildGoogleAiUrl(apiKey, model);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: FULL_AUDIT_PROMPT }] },
          contents: [{ parts: [{ text: `CV:\n${cvText}\n\nTeaser hints (optional):\n${teaserHints}` }] }],
        }),
        signal: requestController.signal,
      });
      if (!response.ok) continue;
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = parseAuditJson(text);
      if (parsed) return parsed;
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.warn('[full-audit] model request timed out; trying next model', { model, modelTimeoutMs });
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  return fallbackAudit(cvText);
}

exports.runFullAudit = runFullAudit;

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch (e) {}
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const runId = String(body.runId || '').trim();
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
    const run = await getRun(runId);
    if (!run?.original_cv_text) return { statusCode: 404, body: JSON.stringify({ error: 'run not found or missing CV text.' }) };

    const audit = await runFullAudit(runId, run.original_cv_text, run.audit_result || '');
    await upsertRun(runId, {
      full_audit_result: audit,
      full_audit_completed_at: new Date().toISOString(),
      fulfillment_status: 'full_audit_completed',
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, runId, audit }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Full audit failed.' }) };
  }
};
