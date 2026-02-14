const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const { buildGoogleAiUrl } = require('./google-ai');
const { LINKEDIN_UPSELL_STATUS, getRun, updateRun } = require('./run-store');

const RATE_LIMIT_MS = 20_000;

function parseLinkedinOutput(text) {
  const headlineMatch = text.match(/Headline:\s*([\s\S]*?)\n\s*About:/i);
  const aboutMatch = text.match(/About:\s*([\s\S]*)$/i);
  return {
    headline: headlineMatch ? headlineMatch[1].trim() : '',
    about: aboutMatch ? aboutMatch[1].trim() : text.trim(),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { runId } = JSON.parse(event.body || '{}');
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    if (![LINKEDIN_UPSELL_STATUS.PAID, LINKEDIN_UPSELL_STATUS.GENERATED].includes(run.linkedin_upsell_status)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Payment is required before generation.' }) };
    }
    if (run.linkedin_docx_base64) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, downloadUrl: `/.netlify/functions/linkedin-download-docx?runId=${encodeURIComponent(runId)}` }) };
    }

    const now = Date.now();
    const lastAttempt = run.linkedin_last_generate_attempt_at ? Date.parse(run.linkedin_last_generate_attempt_at) : 0;
    if (now - lastAttempt < RATE_LIMIT_MS) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Please wait before generating again.' }) };
    }

    if (!run.revised_cv_text) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing revised_cv_text for this run.' }) };
    }

    await updateRun(runId, () => ({ linkedin_last_generate_attempt_at: new Date().toISOString() }));

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const apiUrl = buildGoogleAiUrl(apiKey);
    const prompt = `Using ONLY the revised CV text below, generate:\n1) LinkedIn Headline (180-220 characters, professional, keyword-rich, no invented employers/titles)\n2) LinkedIn About section (1800-2600 characters; hook line, 2-3 short paragraphs, inline 'Core strengths:' list with 6-10 items, CV-grounded achievements only, soft CTA).\nDo not fetch LinkedIn data.\nReturn exactly in this format:\nHeadline: ...\nAbout: ...\n\nRevised CV:\n${run.revised_cv_text}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: 'AI generation failed.' }) };
    }
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { statusCode: 500, body: JSON.stringify({ error: 'No AI output generated.' }) };

    const { headline, about } = parseLinkedinOutput(text);
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'LinkedIn Optimization', heading: HeadingLevel.TITLE }),
          new Paragraph({ text: 'LinkedIn Headline', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun(headline)] }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: 'About', heading: HeadingLevel.HEADING_1 }),
          ...about.split('\n').filter(Boolean).map((line) => new Paragraph({ children: [new TextRun(line)] })),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await updateRun(runId, () => ({
      linkedin_docx_base64: buffer.toString('base64'),
      linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.GENERATED,
      linkedin_upsell_generated_at: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true, downloadUrl: `/.netlify/functions/linkedin-download-docx?runId=${encodeURIComponent(runId)}` }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'LinkedIn doc generation failed.' }) };
  }
};
