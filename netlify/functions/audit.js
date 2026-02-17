const { buildGoogleAiUrl } = require('./google-ai');

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

    const apiUrl = buildGoogleAiUrl(process.env.GOOGLE_AI_API_KEY);

    const payload = {
      systemInstruction: {
        parts: [{ text: AUDIT_SYSTEM_PROMPT }],
      },
      contents: [
        { parts: [{ text: `Audit this CV now:\n\n${cvText}` }] },
      ],
    };

    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json();
      console.error('API Error:', errorData);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: errorData.error?.message || 'AI request failed' }),
      };
    }

    const result = await fetchResponse.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ auditResult: text || 'No response from AI' }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
