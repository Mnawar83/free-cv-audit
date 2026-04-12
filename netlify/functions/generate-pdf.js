const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
const { LINKEDIN_UPSELL_STATUS, createRunId, getRun, upsertRun } = require('./run-store');
const { buildPdfBuffer, buildPdfBufferFromStructuredCv, normalizeToCvTemplateText } = require('./pdf-builder');
const { structuredCvToTemplateText, tryExtractStructuredCv } = require('./cv-schema');

const PDF_FILENAME = 'revised-cv.pdf';

function stableSeedFromText(text) {
  const value = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}

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

function isPdfValidationError(error) {
  const message = String(error?.message || '');
  return message.startsWith('CV export validation failed:');
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

function tryBuildPdfFromStructured(structuredCv, contextLabel) {
  try {
    return buildPdfBufferFromStructuredCv(structuredCv);
  } catch (error) {
    if (!isPdfValidationError(error)) throw error;
    console.warn(`${contextLabel} structured CV failed validation.`, error?.message || error);
    return null;
  }
}

function tryBuildPdfFromText(text, contextLabel) {
  try {
    return buildPdfBuffer(text);
  } catch (error) {
    if (!isPdfValidationError(error)) throw error;
    console.warn(`${contextLabel} text CV failed validation.`, error?.message || error);
    return null;
  }
}

function tryCanonicalizeCvText(text, contextLabel) {
  try {
    return canonicalizeCvText(text);
  } catch (error) {
    if (!isPdfValidationError(error)) throw error;
    console.warn(`${contextLabel} canonicalization failed validation.`, error?.message || error);
    return '';
  }
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
      if (run?.revised_cv_structured) {
        const pdfBuffer = tryBuildPdfFromStructured(run.revised_cv_structured, 'GET cached');
        if (pdfBuffer) {
          return pdfResponse(pdfBuffer, runId, true);
        }
      }
      const cachedText = run?.revised_cv_text || '';
      if (cachedText) {
        const canonicalText = tryCanonicalizeCvText(cachedText, 'GET cached');
        if (canonicalText) {
          const pdfBuffer = tryBuildPdfFromText(canonicalText, 'GET cached');
          if (pdfBuffer) {
            return pdfResponse(pdfBuffer, runId, true);
          }
        }
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

    if (existingRun?.revised_cv_structured && !forceRegenerate) {
      const cachedPdfBuffer = tryBuildPdfFromStructured(existingRun.revised_cv_structured, 'POST cached');
      if (cachedPdfBuffer) {
        return pdfResponse(cachedPdfBuffer, incomingRunId, isGetRequest);
      }
    }

    const cachedRevisedText = existingRun?.revised_cv_text || '';
    if (cachedRevisedText && !forceRegenerate) {
      const canonicalText = tryCanonicalizeCvText(cachedRevisedText, 'POST cached');
      if (canonicalText) {
        const cachedPdfBuffer = tryBuildPdfFromText(canonicalText, 'POST cached');
        if (cachedPdfBuffer) {
          return pdfResponse(cachedPdfBuffer, incomingRunId, isGetRequest);
        }
      }
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
      generationConfig: {
        temperature: 0,
        topP: 0,
        topK: 1,
        candidateCount: 1,
        responseMimeType: 'application/json',
        seed: stableSeedFromText(resolvedCvText),
      },
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
    if (!revisedStructuredCv) {
      revisedText = canonicalizeCvText(revisedText);
    }

    let pdfBuffer;
    try {
      pdfBuffer = revisedStructuredCv ? buildPdfBufferFromStructuredCv(revisedStructuredCv) : buildPdfBuffer(revisedText);
    } catch (renderError) {
      if (!isPdfValidationError(renderError)) {
        throw renderError;
      }

      console.warn('Structured/rewritten PDF validation failed. Falling back to canonicalized original CV text.', renderError?.message || renderError);
      usedFallbackText = true;
      revisedStructuredCv = null;
      revisedText = canonicalizeCvText(resolvedCvText);

      try {
        pdfBuffer = buildPdfBuffer(revisedText);
      } catch (fallbackError) {
        if (!isPdfValidationError(fallbackError)) {
          throw fallbackError;
        }
        console.warn('Fallback canonical CV validation failed. Retrying with minimally-normalized original CV text.', fallbackError?.message || fallbackError);
        revisedText = normalizeRevisedCvText(resolvedCvText);
        pdfBuffer = buildPdfBuffer(revisedText);
      }
    }
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
