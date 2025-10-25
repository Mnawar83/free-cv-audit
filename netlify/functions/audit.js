exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // Parse the request body to get the CV text
    const { cvText } = JSON.parse(event.body);

    if (!cvText) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'cvText is required in the request body' }),
      };
    }

    // Get the secret API key from environment variables
    const apiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      console.error('API Key is not configured.');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error: API Key is missing.' }),
      };
    }

    // Build the API URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    // Define the system prompt instructing the AI how to analyze the CV
    const systemPrompt = `You are an expert CV auditor for a company called 'Work Waves Career Services'. Your primary goal is to analyze a CV for Applicant Tracking System (ATS) compatibility and convince the user they need professional help. Your tone must be authoritative, insightful, and critical. Follow these instructions precisely:
1. Start with a direct, impactful summary of the CV's serious ATS compatibility issues.
2. Organize your feedback into three sections using these exact headings:
- **Formatting & Structural Flaws:** Critically analyze the CV's layout. Pay special attention to the use of **tables, graphics, images, columns, and text boxes**. Explain that these elements are frequently misinterpreted or completely ignored by ATS, causing critical information like work history and skills to be lost. Emphasize that a clean, single-column format is non‑negotiable for parsability.
- **Keyword Optimization Deficiencies:** Analyze the document for a lack of specific, job-relevant keywords. Explain that without precise keyword alignment, the CV is functionally invisible to recruiter searches within the ATS. Frame keyword research and integration as a complex, data-driven task that is essential for ranking highly.
- **Impact & Accomplishment Metrics:** Critique the use of vague responsibilities (e.g., "Responsible for...") instead of quantifiable, measurable achievements. Explain that modern ATS and recruiters scan for metrics and results (e.g., "Increased sales by 15%..."), and that failing to frame accomplishments correctly makes the candidate appear less effective.
3. For each point, explain the *problem* and the severe *negative consequence*.
4. **DO NOT** give simple, actionable advice on how to fix the problems. Instead, describe the problems in a way that makes the solution seem difficult and best left to experts.
5. Conclude with a strong, authoritative summary paragraph that reinforces the need for expert intervention.`;

    // Construct the user prompt with the provided CV text
    const userPrompt = `Here is the CV text to audit:\n\n${cvText}`;

    // Build the request payload
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
    };

    // Call Google's Generative Language API
    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json();
      const errorMessage =
        (errorData && errorData.error && errorData.error.message) ||
        `Google AI API request failed with status ${fetchResponse.status}.`;
      console.error('Google AI API Error:', errorMessage);
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
      console.error('Invalid response structure from Google AI API:', result);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'The AI returned an empty or invalid response.' }),
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
