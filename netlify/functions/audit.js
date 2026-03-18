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
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { cvText } = JSON.parse(event.body || '{}');
    if (!cvText) return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };
    const runId = createRunId();

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const candidateModels = getGoogleAiCandidateModels();

    const payload = {
      systemInstruction: {
        parts: [{ text: AUDIT_SYSTEM_PROMPT }],
      },
      contents: [
        { parts: [{ text: `Audit this CV now:\n\n${cvText}` }] },
      ],
    };

    let auditResult = '';
    let lastErrorMessage = 'AI request failed';

    for (const model of candidateModels) {
      try {
        const apiUrl = buildGoogleAiUrl(apiKey, model);
        const fetchResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (fetchResponse.ok) {
          const result = await fetchResponse.json();
          auditResult = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          break;
        }

        let errorMessage = 'AI request failed';
        try {
          const errorData = await fetchResponse.json();
          if (errorData?.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch (parseError) {
          console.error('Unable to parse AI error response.', parseError);
        }

        const modelNotAvailable =
          fetchResponse.status === 404 || /not found|unsupported|not available/i.test(errorMessage);
        if (modelNotAvailable) {
          lastErrorMessage = `${model}: ${errorMessage}`;
          continue;
        }

        lastErrorMessage = errorMessage;
        break;
      } catch (error) {
        const errorMessage = error?.message || 'unknown';
        const modelNotAvailable = /missing|not found|unsupported|not available/i.test(errorMessage);
        if (modelNotAvailable) {
          lastErrorMessage = `${model}: ${errorMessage}`;
          continue;
        }
        lastErrorMessage = errorMessage;
        break;
      }
    }

    if (!auditResult) {
      console.error('Audit AI call failed:', lastErrorMessage);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: lastErrorMessage }),
      };
    }

    await upsertRun(runId, {
      original_cv_text: cvText,
      audit_result: auditResult,
      audit_completed_at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ auditResult, runId }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
