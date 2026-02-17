const { Document, Packer, Paragraph, TextRun } = require('docx');
const { buildGoogleAiUrl } = require('./google-ai');
const { COVER_LETTER_STATUS, getRun, updateRun } = require('./run-store');
const { fetchJobPageWithPuppeteer } = require('./job-page-fetcher');
const { COVER_LETTER_AI_JOB_TEXT_MAX, COVER_LETTER_JOB_TEXT_THRESHOLD } = require('./cover-letter-constants');

function buildPrompt(revisedCvText, jobPageText, jobPageTextLength) {
  if (jobPageTextLength >= COVER_LETTER_JOB_TEXT_THRESHOLD) {
    return `CANDIDATE PROFILE:\n${revisedCvText}\n\nJOB POST CONTENT:\n${jobPageText.slice(0, COVER_LETTER_AI_JOB_TEXT_MAX)}\n\nINSTRUCTIONS:\n1. Write a tailored cover letter using both the candidate profile and job post.\n2. Extract job title and company name ONLY if clearly present in JOB POST CONTENT.\n3. If company name cannot be reliably identified, use generic phrases:\n   'your team', 'your organization', 'your company'.\n4. If job title cannot be reliably identified, refer to:\n   'this role' or 'this opportunity'.\n5. Do NOT invent employers, metrics, certifications, or experience not present in the candidate profile or job post.\n6. Do NOT exaggerate.\n7. Tone: confident, professional, concise.\n8. Length: 250–400 words.\n9. Structure:\n   - Paragraph 1: Greeting and intent.\n   - Paragraph 2–3: Align candidate strengths with job requirements.\n   - Final paragraph: Closing statement and call to action.\n10. Do not use bullet points.\n11. Output plain text paragraphs only (no markdown).\n12. Do not include the title 'Cover Letter' in the output.\n\nReturn only the body content.`;
  }

  return `CANDIDATE PROFILE:\n${revisedCvText}\n\nINSTRUCTIONS:\n1. Write a strong general-purpose professional cover letter.\n2. Do NOT reference any specific company name.\n3. Do NOT reference any specific job title.\n4. Use generic phrases such as:\n   'this opportunity', 'your organization', 'your company'.\n5. Do NOT invent employers, metrics, certifications, or experience not present in the candidate profile.\n6. Tone: confident, professional, concise.\n7. Length: 250–400 words.\n8. Structure:\n   - Paragraph 1: Professional introduction and intent.\n   - Paragraph 2–3: Core strengths and relevant experience.\n   - Final paragraph: Closing statement and call to action.\n9. No bullet points.\n10. Output plain text paragraphs only (no markdown).\n11. Do not include the title 'Cover Letter' in the output.\n\nReturn only the body content.`;
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
