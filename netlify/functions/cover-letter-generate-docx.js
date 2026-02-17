const { Document, Packer, Paragraph, TextRun } = require('docx');
const { buildGoogleAiUrl } = require('./google-ai');
const { COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');
const { fetchJobPageWithPuppeteer } = require('./job-page-fetcher');
const { COVER_LETTER_AI_JOB_TEXT_MAX, COVER_LETTER_JOB_TEXT_THRESHOLD } = require('./cover-letter-constants');

function buildPrompt(revisedCvText, jobPageText, jobPageTextLength) {
  if (jobPageTextLength >= COVER_LETTER_JOB_TEXT_THRESHOLD) {
    return `CANDIDATE PROFILE:
${revisedCvText}

JOB POST CONTENT:
${jobPageText.slice(0, COVER_LETTER_AI_JOB_TEXT_MAX)}

INSTRUCTIONS:
1. Write a tailored cover letter using both the candidate profile and job post.
2. Extract company name ONLY if clearly present in JOB POST CONTENT.
3. If company name cannot be reliably identified, use generic phrases:
   'your team', 'your organization', 'your company'.
4. Always refer to the position as:
   'this role'.
5. Never mention or infer a specific job title, even if one appears in the job post.
6. Do NOT invent employers, metrics, certifications, or experience not present in the candidate profile or job post.
7. Do NOT exaggerate.
8. Tone: confident, professional, concise.
9. Length: 250–400 words.
10. Structure:
   - Paragraph 1: Greeting and intent.
   - Paragraph 2–3: Align candidate strengths with job requirements.
   - Final paragraph: Closing statement and call to action.
11. Do not use bullet points.
12. Output plain text paragraphs only (no markdown).
13. Do not include the title 'Cover Letter' in the output.

Return only the body content.`;
  }

  return `CANDIDATE PROFILE:
${revisedCvText}

INSTRUCTIONS:
1. Write a strong general-purpose professional cover letter.
2. Do NOT reference any specific company name.
3. Never mention any specific job title.
4. Always use the phrase 'this role' for the position reference.
5. Use generic company phrases such as 'your organization' or 'your company'.
6. Do NOT invent employers, metrics, certifications, or experience not present in the candidate profile.
7. Tone: confident, professional, concise.
8. Length: 250–400 words.
9. Structure:
   - Paragraph 1: Professional introduction and intent.
   - Paragraph 2–3: Core strengths and relevant experience.
   - Final paragraph: Closing statement and call to action.
10. No bullet points.
11. Output plain text paragraphs only (no markdown).
12. Do not include the title 'Cover Letter' in the output.

Return only the body content.`;
}


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { runId } = JSON.parse(event.body || '{}');
    if (!runId) return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };

    const run = await getRun(runId);
    if (!run) return { statusCode: 404, body: JSON.stringify({ error: 'Run not found.' }) };
    if (![COVER_LETTER_STATUS.PAID, COVER_LETTER_STATUS.GENERATED].includes(run.cover_letter_status)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Payment is required before generation.' }) };
    }
    if (!run.revised_cv_text) return { statusCode: 400, body: JSON.stringify({ error: 'Missing revised_cv_text for this run.' }) };
    if (run.cover_letter_docx_base64) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, usedJobText: Boolean(run.used_job_text), downloadUrl: `/.netlify/functions/cover-letter-download-docx?runId=${encodeURIComponent(runId)}` }) };
    }

    let jobPageText = run.job_page_text || '';
    let jobPageTextLength = Number(run.job_page_text_length || 0);
    let fetchError = run.job_page_fetch_error || '';

    if (!jobPageText && run.job_link) {
      const fetched = await fetchJobPageWithPuppeteer(run.job_link);
      jobPageText = fetched.text || '';
      jobPageTextLength = Number(fetched.length || 0);
      fetchError = fetched.error || '';
      await updateRun(runId, () => ({
        job_page_text: jobPageText,
        job_page_text_length: jobPageTextLength,
        job_page_fetch_error: fetchError,
      }));
    }

    const usedJobText = jobPageTextLength >= COVER_LETTER_JOB_TEXT_THRESHOLD;
    const prompt = buildPrompt(run.revised_cv_text, jobPageText, jobPageTextLength);
    const apiUrl = buildGoogleAiUrl(process.env.GOOGLE_AI_API_KEY);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: 'You are writing a professional job application cover letter.' }] },
      }),
    });

    if (!response.ok) return { statusCode: 500, body: JSON.stringify({ error: 'AI generation failed.' }) };
    const result = await response.json();
    const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!outputText) return { statusCode: 500, body: JSON.stringify({ error: 'No AI output generated.' }) };

    const bodyParagraphs = outputText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const children = [new Paragraph({ children: [new TextRun({ text: 'Cover Letter', bold: true, font: 'Times New Roman', size: 24 })] })];
    for (const paragraphText of bodyParagraphs) {
      children.push(new Paragraph({ children: [new TextRun({ text: paragraphText, font: 'Times New Roman', size: 24 })] }));
      children.push(new Paragraph({ children: [new TextRun({ text: '', font: 'Times New Roman', size: 24 })] }));
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    await updateRun(runId, () => ({
      cover_letter_docx_base64: buffer.toString('base64'),
      cover_letter_status: COVER_LETTER_STATUS.GENERATED,
      used_job_text: usedJobText,
      cover_letter_generated_at: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true, usedJobText, downloadUrl: `/.netlify/functions/cover-letter-download-docx?runId=${encodeURIComponent(runId)}` }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Cover letter generation failed.' }) };
  }
};
