exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { cvText } = JSON.parse(event.body);
    if (!cvText) return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const { buildGoogleAiUrl } = require('./google-ai');
    const apiUrl = buildGoogleAiUrl(apiKey);

    const systemPrompt = `You are an expert CV auditor for 'Work Waves Career Services'. ...`; // Your prompt here

    const payload = {
      // systemInstruction MUST be in camelCase for the REST API
      systemInstruction: { 
        parts: [{ text: systemPrompt }] 
      },
      contents: [
        { parts: [{ text: `Here is the CV text to audit:\n\n${cvText}` }] }
      ]
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
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    return {
      statusCode: 200,
      body: JSON.stringify({ auditResult: text?.trim() || 'No response from AI' }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
