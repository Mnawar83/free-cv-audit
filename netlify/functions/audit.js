const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
const { createRunId, upsertRun } = require('./run-store');
const { badRequest, parseJsonBody } = require('./http-400');

const AUDIT_SYSTEM_PROMPT = `You are a senior ATS CV auditor for Work Waves Career Services.

Return a complete audit immediately. Never say you are ready to begin and never ask for permission.

Write a practical, concise CV audit in plain text using this exact structure:
Overall ATS Match: <0-100>%

Strengths:
- <bullet>
- <bullet>

Issues to Fix:
- <bullet>
- <bullet>

Keyword Gaps:
- <missing keyword or phrase>
- <missing keyword or phrase>

Formatting & ATS Parsing Risks:
- <risk>
- <risk>

Suggested Improvements (Prioritized):
1) <improvement>
2) <improvement>
3) <improvement>

Do not include a rewritten professional summary section.
Do not include markdown code fences. Do not include any preamble. Base everything strictly on the provided CV text and do not invent facts.`;

const RETRYABLE_STATUS_CODES = new Set([429, 503, 504]);
const RETRYABLE_ERROR_PATTERNS = [
  /high demand/i,
  /resource exhausted/i,
  /temporarily unavailable/i,
  /rate limit/i,
  /timed out/i,
  /timeout/i,
];

function isRetryableProviderError(statusCode, message) {
  if (RETRYABLE_STATUS_CODES.has(Number(statusCode))) return true;
  const text = String(message || '');
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function getBackoffDelayMs(attemptIndex) {
  const baseDelays = [250, 700, 1500];
  const base = baseDelays[Math.min(attemptIndex, baseDelays.length - 1)];
  const jitter = Math.floor(Math.random() * 201);
  return base + jitter;
}

function normalizeAuditFailureMessage(rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) return 'The audit service is temporarily unavailable. Please try again shortly.';
  if (isRetryableProviderError(0, message)) {
    return 'Our audit service is experiencing high traffic. Please try again in a moment.';
  }
  if (/api key|unauthorized|permission|forbidden/i.test(message)) {
    return 'Audit service configuration is currently unavailable. Please contact support.';
  }
  return message;
}

exports.handler = async (event) => {
  const functionName = 'audit';
  const route = '/.netlify/functions/audit';
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const parsedBody = parsed.body;

  try {
    const cvText = String(
      parsedBody?.cvText
      || parsedBody?.cv_text
      || parsedBody?.text
      || ''
    );
    if (!cvText.trim()) {
      return badRequest({
        event,
        functionName,
        route,
        message: 'Missing cvText.',
        payload: parsedBody,
        missingFields: ['cvText'],
      });
    }
    const runId = createRunId();

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Google AI API key is missing.' }),
      };
    }

    const candidateModels = getGoogleAiCandidateModels().sort((a, b) => {
      if (a.includes('flash') && !b.includes('flash')) return -1;
      if (!a.includes('flash') && b.includes('flash')) return 1;
      return 0;
    });

    const payload = {
      systemInstruction: {
        parts: [{ text: AUDIT_SYSTEM_PROMPT }],
      },
      contents: [
        { parts: [{ text: `Audit this CV now:\n\n${cvText}` }] },
      ],
    };

    let result;
    let lastErrorMessage = 'AI request failed';
    for (let index = 0; index < candidateModels.length; index++) {
      const model = candidateModels[index];
      const apiUrl = buildGoogleAiUrl(apiKey, model);
      const requestController = new AbortController();
      const requestTimeout = setTimeout(() => requestController.abort(), 12000);
      let fetchResponse;
      let shouldRetryNextModel = false;
      try {
        fetchResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: requestController.signal,
        });
      } catch (requestError) {
        if (requestError?.name === 'AbortError') {
          lastErrorMessage = 'Audit request timed out. Please try again.';
          shouldRetryNextModel = true;
        } else {
          lastErrorMessage = requestError?.message || lastErrorMessage;
          shouldRetryNextModel = isRetryableProviderError(0, lastErrorMessage);
        }
      } finally {
        clearTimeout(requestTimeout);
      }

      if (!fetchResponse) {
        if (shouldRetryNextModel && index < candidateModels.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, getBackoffDelayMs(index)));
        }
        continue;
      }

      if (fetchResponse.ok) {
        result = await fetchResponse.json();
        break;
      }

      const statusCode = fetchResponse.status;
      try {
        const errorText = await fetchResponse.text();
        let errorData = {};
        if (errorText && errorText.trim()) {
          try {
            errorData = JSON.parse(errorText);
          } catch (_ignored) {
            errorData = { error: { message: errorText.slice(0, 240) } };
          }
        }
        console.error('API Error:', errorData);
        if (errorData?.error?.message) {
          lastErrorMessage = errorData.error.message;
        } else if (errorText && errorText.trim()) {
          lastErrorMessage = errorText.slice(0, 240);
        }
        shouldRetryNextModel = isRetryableProviderError(statusCode, lastErrorMessage);
      } catch (parseError) {
        console.error('Unable to parse AI error response.', parseError);
        shouldRetryNextModel = isRetryableProviderError(statusCode, lastErrorMessage);
      }

      if (shouldRetryNextModel && index < candidateModels.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, getBackoffDelayMs(index)));
      }
    }

    if (!result) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: normalizeAuditFailureMessage(lastErrorMessage), code: 'AUDIT_TEMP_UNAVAILABLE' }),
      };
    }

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const auditResult = text || 'No response from AI';

    const runPayload = {
      original_cv_text: cvText,
      audit_result: auditResult,
      audit_completed_at: new Date().toISOString(),
    };
    let stored = false;
    let lastStoreErrorMessage = '';
    for (let attempt = 0; attempt < 3 && !stored; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        }
        await upsertRun(runId, runPayload);
        stored = true;
      } catch (storeError) {
        lastStoreErrorMessage = storeError?.message || String(storeError || '');
        console.error(`Failed to persist audit run (attempt ${attempt + 1}):`, lastStoreErrorMessage);
      }
    }

    if (!stored) {
      if (lastStoreErrorMessage.includes('Durable run storage is required in production')) {
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Audit completed, but saving is unavailable due to a server configuration issue. Please contact support.',
          }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditResult, runId, saveWarning: 'Audit result could not be saved. Some features may be unavailable.' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditResult, runId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
