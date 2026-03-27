const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
const { createRunId, upsertRun } = require('./run-store');

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { cvText } = JSON.parse(event.body || '{}');
    if (!cvText) return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };
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
    for (const model of candidateModels) {
      const apiUrl = buildGoogleAiUrl(apiKey, model);
      const requestController = new AbortController();
      const requestTimeout = setTimeout(() => requestController.abort(), 12000);
      let fetchResponse;
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
          continue;
        }
        lastErrorMessage = requestError?.message || lastErrorMessage;
        continue;
      } finally {
        clearTimeout(requestTimeout);
      }

      if (fetchResponse.ok) {
        result = await fetchResponse.json();
        break;
      }

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
        }
      } catch (parseError) {
        console.error('Unable to parse AI error response.', parseError);
      }
    }

    if (!result) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: lastErrorMessage }),
      };
    }

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const auditResult = text || 'No response from AI';

    let storedRunId = runId;
    try {
      await upsertRun(runId, {
        original_cv_text: cvText,
        audit_result: auditResult,
        audit_completed_at: new Date().toISOString(),
      });
    } catch (storeError) {
      console.error('Failed to persist audit run:', storeError.message || storeError);
      storedRunId = '';
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditResult, runId: storedRunId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
