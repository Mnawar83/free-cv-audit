exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { cvText } = JSON.parse(event.body);

    if (!cvText) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'cvText is required' }),
      };
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API Key missing in environment variables.' }),
      };
    }

    /**
     * FIX: Use the v1 (Stable) endpoint and the correct GA model name.
     * As of late 2025, 'gemini-1.5-flash' is the most stable and cost-effective choice.
     * Note: There is currently no 'Gemini 2.5' model; 1.5 or 2.0 are the correct versions.
     */
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const systemPrompt = `You are an expert CV auditor for 'Work Waves Career Services'. 
    Analyze the CV for ATS compatibility. Tone: authoritative and critical.
    Structure: 
    1. Impactful Summary.
    2. Sections: **Formatting & Structural Flaws**, **Keyword Optimization Deficiencies**, **Impact & Accomplishment Metrics**.
    Explain problems and consequences without giving easy fixes, emphasizing the need for expert help.`;

    const userPrompt = `Here is the CV text to audit:\n\n${cvText}`;

    const payload = {
      // System instructions are now supported in the v1 stable endpoint for 1.5 models
      systemInstruction: { 
        parts: [{ text: systemPrompt }] 
      },
      contents: [
        { parts: [{ text: userPrompt }] }
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    };

    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json();
      // This will help you see the exact reason if Google rejects the key or model again
      console.error('Detailed API Error:', errorData);
      return {
        statusCode: fetchResponse.status,
        body: JSON.stringify({ error: errorData.error?.message || 'API Request Failed' }),
      };
    }

    const result = await fetchResponse.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (text) {
      return {
        statusCode: 200,
        body: JSON.stringify({ auditResult: text.trim() }),
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'AI returned an empty response. It may have flagged the content.' }),
      };
    }
  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error occurred.' }),
    };
  }
};
