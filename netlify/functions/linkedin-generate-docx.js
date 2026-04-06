const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
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

function sanitizeDocxText(input) {
  if (!input) return '';

  let output = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    const isAllowedXmlChar =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);

    if (isAllowedXmlChar) {
      output += char;
    }
  }

  return output;
}

function sanitizePdfText(input) {
  return sanitizeDocxText(input || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

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
      return { statusCode: 200, body: JSON.stringify({ ok: true, pdfUrl: `/.netlify/functions/linkedin-download-pdf?runId=${encodeURIComponent(runId)}`, downloadUrl: `/.netlify/functions/linkedin-download-docx?runId=${encodeURIComponent(runId)}` }) };
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
    if (!apiKey) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Google AI API key is missing.' }) };
    }

    const candidateModels = getGoogleAiCandidateModels().sort((a, b) => {
      if (a.includes('flash') && !b.includes('flash')) return -1;
      if (!a.includes('flash') && b.includes('flash')) return 1;
      return 0;
    });

    const prompt = `Using ONLY the revised CV text below, generate:\n1) LinkedIn Headline (180-220 characters, professional, keyword-rich, no invented employers/titles)\n2) LinkedIn About section (1800-2600 characters; hook line, 2-3 short paragraphs, inline 'Core strengths:' list with 6-10 items, CV-grounded achievements only, soft CTA).\nDo not fetch LinkedIn data.\nReturn exactly in this format:\nHeadline: ...\nAbout: ...\n\nRevised CV:\n${run.revised_cv_text}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    let result;
    let lastErrorMessage = 'AI generation failed.';
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
          lastErrorMessage = 'LinkedIn generation request timed out. Please try again.';
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
        console.error('LinkedIn AI API Error:', errorData);
        if (errorData?.error?.message) {
          lastErrorMessage = errorData.error.message;
        }
      } catch (parseError) {
        console.error('Unable to parse LinkedIn AI error response.', parseError);
      }
    }

    if (!result) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: lastErrorMessage }) };
    }

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { statusCode: 500, body: JSON.stringify({ error: 'No AI output generated.' }) };

    const parsedOutput = parseLinkedinOutput(text);
    const headline = sanitizeDocxText(parsedOutput.headline);
    const about = sanitizeDocxText(parsedOutput.about);
    const baseTextStyle = { font: 'Times New Roman', size: 24 };
    const aboutParagraphLines = about
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'LinkedIn Optimization', heading: HeadingLevel.TITLE, spacing: { after: 240 } }),
          new Paragraph({ text: 'LinkedIn Headline', heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: headline, ...baseTextStyle })], spacing: { after: 240 } }),
          new Paragraph({ text: 'About', heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
          ...aboutParagraphLines.map((line) => new Paragraph({
            children: [new TextRun({ text: line, ...baseTextStyle })],
            spacing: { after: 200 },
          })),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const linkedinPdfText = sanitizePdfText(`LinkedIn Optimization\n\nLinkedIn Headline:\n${headline}\n\nAbout:\n${about}`);
    await updateRun(runId, () => ({
      linkedin_docx_base64: buffer.toString('base64'),
      linkedin_pdf_text: linkedinPdfText,
      linkedin_upsell_status: LINKEDIN_UPSELL_STATUS.GENERATED,
      linkedin_upsell_generated_at: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true, pdfUrl: `/.netlify/functions/linkedin-download-pdf?runId=${encodeURIComponent(runId)}`, downloadUrl: `/.netlify/functions/linkedin-download-docx?runId=${encodeURIComponent(runId)}` }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'LinkedIn doc generation failed.' }) };
  }
};
