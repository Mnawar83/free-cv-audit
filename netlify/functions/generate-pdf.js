const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
const { LINKEDIN_UPSELL_STATUS, createRunId, getRun, upsertRun } = require('./run-store');
const { buildPdfBuffer, normalizeToCvTemplateText } = require('./pdf-builder');
const { maybeStructuredCvToTemplateText, structuredCvToTemplateText, tryExtractStructuredCv } = require('./cv-schema');

const PDF_FILENAME = 'revised-cv.pdf';

function normalizeRevisedCvText(text) {
  if (!text) return '';
  let normalized = String(text).replace(/\r\n?/g, '\n');
  normalized = normalized.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  normalized = normalized.replace(/^\s*[-*•]\s+/gm, '- ');
  normalized = normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');

  normalized = normalized
    .replace(/^\s*professional summary\s*:?\s*$/gim, 'PROFESSIONAL SUMMARY')
    .replace(/^\s*core skills\s*:?\s*$/gim, 'CORE SKILLS')
    .replace(/^\s*professional experience\s*:?\s*$/gim, 'PROFESSIONAL EXPERIENCE')
    .replace(/^\s*education\s*:?\s*$/gim, 'EDUCATION')
    .replace(/^\s*certifications?\s*:?\s*$/gim, 'CERTIFICATIONS')
    .replace(/^\s*additional information\s*:?\s*$/gim, 'ADDITIONAL INFORMATION');

  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

function canonicalizeCvText(text) {
  const normalizedText = normalizeRevisedCvText(text);
  return normalizeToCvTemplateText(normalizedText);
}

function resolveStructuredTemplateText(run) {
  if (!run?.revised_cv_structured) return '';
  return maybeStructuredCvToTemplateText(run.revised_cv_structured) || '';
}

function htmlErrorResponse(statusCode, message, options = {}) {
  const { showRetryHint } = options;
  const retryHint = showRetryHint
    ? '<p style="color:#475569;margin:12px 0 0;font-size:14px">If you received this CV by email, check for an attached PDF file — your revised CV may be included as an attachment.</p>'
    : '';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FreeCVAudit</title>
<style>body{font-family:Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:480px;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;text-align:center}
h1{font-size:20px;color:#0f172a;margin:0 0 12px}p{color:#475569;margin:0 0 20px}
a{display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700}</style>
</head><body><div class="card"><h1>Unable to Load Your CV</h1>
<p>${message}</p>
${retryHint}
<a href="https://freecvaudit.com">Go to FreeCVAudit</a></div></body></html>`;
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
}

function pdfResponse(pdfBuffer, runId, inline = false) {
  const disposition = inline ? `inline; filename="${PDF_FILENAME}"` : `attachment; filename="${PDF_FILENAME}"`;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      ...(runId ? { 'x-run-id': runId } : {}),
    },
    body: pdfBuffer.toString('base64'),
    isBase64Encoded: true,
  };
}

exports.handler = async (event) => {
  try { require('@netlify/blobs').connectLambda(event); } catch(e){}

  if (!['POST', 'GET'].includes(event.httpMethod)) {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    let isGetRequest = false;
    let getRunData = null;
    if (event.httpMethod === 'GET') {
      const runId = event.queryStringParameters?.runId;
      if (!runId) {
        return htmlErrorResponse(400, 'The link is missing a reference ID. Please use the link from your email or request a new one from FreeCVAudit.');
      }
      const run = await getRun(runId);
      const structuredText = resolveStructuredTemplateText(run);
      const cachedText = structuredText || run?.revised_cv_text || '';
      if (cachedText) {
        const canonicalText = canonicalizeCvText(cachedText);
        const pdfBuffer = buildPdfBuffer(canonicalText);
        return pdfResponse(pdfBuffer, runId, true);
      }
      if (!run?.original_cv_text) {
        return htmlErrorResponse(404, 'Your revised CV could not be found. The link may have expired. Please visit FreeCVAudit to generate a new one.', { showRetryHint: true });
      }
      isGetRequest = true;
      getRunData = run;
    }

    let incomingRunId;
    let existingRun = null;
    if (isGetRequest) {
      incomingRunId = event.queryStringParameters?.runId;
      existingRun = getRunData;
    } else {
      const body = JSON.parse(event.body || '{}');
      incomingRunId = body.runId;
      var forceRegenerate = Boolean(body.forceRegenerate);
      if (incomingRunId) {
        try {
          existingRun = await getRun(incomingRunId);
        } catch (lookupError) {
          console.warn('Run store lookup failed; proceeding with request body data.', lookupError?.message || lookupError);
        }
      }
      var cvText = body.cvText;
      var cvAnalysis = body.cvAnalysis;
    }
    const resolvedCvText = cvText || existingRun?.original_cv_text || '';
    const resolvedCvAnalysis = cvAnalysis || existingRun?.audit_result || '';

    const cachedStructuredText = resolveStructuredTemplateText(existingRun);
    const cachedRevisedText = cachedStructuredText || existingRun?.revised_cv_text || '';
    if (cachedRevisedText && !forceRegenerate) {
      const canonicalText = canonicalizeCvText(cachedRevisedText);
      const cachedPdfBuffer = buildPdfBuffer(canonicalText);
      return pdfResponse(cachedPdfBuffer, incomingRunId, isGetRequest);
    }
    const candidateModels = getGoogleAiCandidateModels();

    if (!resolvedCvText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const MODEL_TIMEOUT_MS = 25000;

    let result;
    let revisedText = '';
    let revisedStructuredCv = null;
    let usedFallbackText = false;
    let lastErrorMessage = 'AI request failed';

    if (!apiKey) {
      console.warn('Google AI API key is missing. Falling back to original CV text.');
      revisedText = resolvedCvText;
      usedFallbackText = true;
    } else {
    const systemPrompt = `You are a senior CV writer and ATS optimization specialist at Work Waves Career Services.

Rewrite the provided CV into an ATS-friendly, submission-ready version.

Rules:
- Use only facts found in the provided CV text (and optional audit notes).
- Do not invent employers, dates, titles, certifications, tools, or metrics.
- If a metric is missing, strengthen wording without fabricating numbers.
- Keep chronology and tense consistent.
- Return only valid JSON. No preamble. No markdown code fences. No decorative characters or icons.
- Never include placeholder text like "Professional Title", "Candidate Name", "Recent Professional Experience", or generic filler content.
- If a section has no data from the source CV, omit it entirely. Do not generate filler content.

Style:
- Crisp, professional, and impact-oriented.
- Replace weak responsibility statements with achievement-driven bullets.
- Keep bullets concise and avoid repetition.
- Integrate relevant keywords naturally (no keyword stuffing).

Output JSON schema exactly:
{
  "fullName": "string",
  "professionalTitle": "string",
  "contact": {
    "location": "string",
    "phone": "string",
    "email": "string"
  },
  "summary": "string",
  "skills": ["string"],
  "experience": [
    {
      "jobTitle": "string",
      "company": "string",
      "location": "string",
      "dates": "string",
      "bullets": ["string"]
    }
  ],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "date": "string"
    }
  ],
  "certifications": ["string"],
  "languages": ["string"]
}

Critical rules for experience entries:
- Every role object MUST include jobTitle, company, dates, and bullets fields.
- bullets MUST be an array of concise strings; never return paragraph blocks.
- Never combine multiple roles into one role object.

Before returning, verify:
- No invented facts
- No duplicate bullets or sections
- No placeholder or generic filler text
- JSON must be parseable with JSON.parse`;

    const analysisNote = resolvedCvAnalysis
      ? `\n\nReference these audit notes when improving structure, wording, and keyword alignment (without inventing facts):\n${resolvedCvAnalysis}`
      : '';
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: `Rewrite this CV into a polished ATS-optimized version:\n\n${resolvedCvText}${analysisNote}` }] }],
    };

    for (const model of candidateModels) {
      const apiUrl = buildGoogleAiUrl(apiKey, model);
      const requestController = new AbortController();
      const requestTimeout = setTimeout(() => requestController.abort(), MODEL_TIMEOUT_MS);
      let fetchResponse;
      try {
        fetchResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: requestController.signal,
        });
      } catch (requestError) {
        clearTimeout(requestTimeout);
        if (requestError?.name === 'AbortError') {
          lastErrorMessage = `${model}: request timed out`;
          console.warn(`AI rewrite timed out for model ${model}. Trying next model.`);
          continue;
        }
        lastErrorMessage = requestError?.message || lastErrorMessage;
        console.warn(`AI rewrite fetch error for model ${model} (${lastErrorMessage}). Trying next model.`);
        continue;
      } finally {
        clearTimeout(requestTimeout);
      }

      if (fetchResponse.ok) {
        result = await fetchResponse.json();
        break;
      }

      try {
        const errorData = await fetchResponse.json();
        const errorMsg = errorData?.error?.message || '';
        if (errorMsg) {
          lastErrorMessage = errorMsg;
        }

        const modelNotAvailable =
          fetchResponse.status === 404 || fetchResponse.status === 429 || /not found|unsupported|not available|rate|quota/i.test(errorMsg);
        if (modelNotAvailable) {
          lastErrorMessage = `${model}: ${errorMsg || fetchResponse.status}`;
          continue;
        }

        console.warn(`AI rewrite failed (${errorMsg}). Falling back to original CV text.`);
        revisedText = resolvedCvText;
        usedFallbackText = true;
        break;
      } catch (error) {
        const errorMessage = error?.message || 'unknown';
        const modelNotAvailable = /missing|not found|unsupported|not available|rate|quota/i.test(errorMessage);
        if (modelNotAvailable) {
          lastErrorMessage = `${model}: ${errorMessage}`;
          continue;
        }
        console.warn(`AI rewrite request threw an error (${errorMessage}). Falling back to original CV text.`);
        revisedText = resolvedCvText;
        usedFallbackText = true;
        break;
      }
    }

    if (!result && !usedFallbackText) {
      console.warn(`AI rewrite failed (${lastErrorMessage}). Falling back to original CV text.`);
      revisedText = resolvedCvText;
      usedFallbackText = true;
    } else if (result) {
      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      const structuredCv = tryExtractStructuredCv(aiText);
      if (structuredCv) {
        revisedStructuredCv = structuredCv;
        revisedText = structuredCvToTemplateText(structuredCv);
      } else {
        console.warn('AI rewrite returned non-parseable structured JSON. Falling back to original CV text.');
        revisedText = resolvedCvText;
        usedFallbackText = true;
      }
    }
    } // end of apiKey else block

    if (!revisedText) {
      console.warn(`No compatible Google AI model available (${lastErrorMessage}). Falling back to original CV text.`);
      revisedText = resolvedCvText;
      usedFallbackText = true;
    }
    revisedText = canonicalizeCvText(revisedText);

    const pdfBuffer = buildPdfBuffer(revisedText);
    let runId = incomingRunId || createRunId();

    if (
      existingRun &&
      existingRun.linkedin_upsell_status &&
      existingRun.linkedin_upsell_status !== LINKEDIN_UPSELL_STATUS.NOT_STARTED
    ) {
      runId = createRunId();
    }

    const runUpdates = {
      original_cv_text: resolvedCvText,
      audit_result: resolvedCvAnalysis,
      revised_cv_text: revisedText,
      revised_cv_structured: revisedStructuredCv,
      revised_cv_generated_at: new Date().toISOString(),
    };
    if (usedFallbackText) {
      runUpdates.revised_cv_fallback_generated_at = new Date().toISOString();
    } else {
      runUpdates.revised_cv_fallback_generated_at = null;
    }

    let runStored = false;
    try {
      await upsertRun(runId, runUpdates);
      runStored = true;
    } catch (storeError) {
      console.warn('Run store upsert failed; retrying once.', storeError?.message || storeError);
      try {
        await upsertRun(runId, runUpdates);
        runStored = true;
      } catch (retryError) {
        console.warn('Run store upsert retry failed; returning PDF without caching.', retryError?.message || retryError);
      }
    }

    return pdfResponse(pdfBuffer, runStored ? runId : '', isGetRequest);
  } catch (error) {
    console.error('Generate PDF failure.', error);
    if (event.httpMethod === 'GET') {
      return htmlErrorResponse(500, 'Something went wrong while preparing your CV. Please try again or visit FreeCVAudit to request a new copy.', { showRetryHint: true });
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
