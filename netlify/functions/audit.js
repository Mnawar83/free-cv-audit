exports.handler = async (event, context) => {
  // 1. Guard against non-POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // 2. Parse input
    const { cvText } = JSON.parse(event.body);

    if (!cvText) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'cvText is required in the request body' }),
      };
    }

    // 3. Environment Variable Check
    const apiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      console.error('API Key is missing from Environment Variables.');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error: API Key is missing.' }),
      };
    }

    /**
     * FIX 1: Use the v1beta endpoint (required for systemInstruction) 
     * FIX 2: Use a valid, stable model (gemini-1.5-flash)
     */
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const systemPrompt = `You are an expert CV auditor for a company called 'Work Waves Career Services'. Your primary goal is to analyze a CV for Applicant Tracking System (ATS) compatibility and convince the user they need professional help. Your tone must be authoritative, insightful, and critical. Follow these instructions precisely:
1. Start with a direct, impactful summary of the CV's serious ATS compatibility issues.
2. Organize your feedback into three sections using these exact headings:
- **Formatting & Structural Flaws:** Critically analyze the CV's layout. Pay special attention to the use of **tables, graphics, images, columns, and text boxes**. Explain that these elements are frequently misinterpreted or completely ignored by ATS.
- **Keyword Optimization Deficiencies:** Analyze the document for a lack of specific, job-relevant keywords.
- **Impact & Accomplishment Metrics:** Critique the use of vague responsibilities instead of quantifiable achievements.
3. For each point, explain the *problem* and the severe *negative consequence*.
4. **DO NOT** give simple, actionable advice. Make the solution seem difficult and best left to experts.
5. Conclude with a strong, authoritative summary paragraph.`;

    const userPrompt = `Here is the CV text to audit:\n\n${cvText}`;

    // 4. Payload (Matches v1beta structure)
    const payload = {
      systemInstruction: { 
        parts: [{ text: systemPrompt }] 
      },
      contents: [
        { parts: [{ text: userPrompt }] }
      ],
    };

    // 5. API Call
    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // 6. Detailed Error Handling
    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json();
      const errorMessage = errorData?.error?.message || `Google AI API failed with status ${fetchResponse.status}`;
      console.error('API Error Details:', JSON.stringify(errorData));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: errorMessage }),
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
        body: JSON.stringify({ error: 'The AI returned an empty response. Check if content was flagged by safety filters.' }),
      };
    }
  } catch (error) {
    console.error('Internal Server Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an issue connecting to the AI analysis service.' }),
    };
  }
};
