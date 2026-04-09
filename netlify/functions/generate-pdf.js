const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require('./google-ai');
const { LINKEDIN_UPSELL_STATUS, createRunId, getRun, upsertRun } = require('./run-store');
const { buildPdfBuffer } = require('./pdf-builder');

const PDF_FILENAME = 'revised-cv.pdf';

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
      if (run?.revised_cv_text) {
        const pdfBuffer = buildPdfBuffer(run.revised_cv_text);
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

    if (existingRun?.revised_cv_text) {
      const cachedPdfBuffer = buildPdfBuffer(existingRun.revised_cv_text);
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
    let usedFallbackText = false;
    let lastErrorMessage = 'AI request failed';

    if (!apiKey) {
      console.warn('Google AI API key is missing. Falling back to original CV text.');
      revisedText = resolvedCvText;
      usedFallbackText = true;
    } else {
    const systemPrompt = `You are a senior executive CV writer and ATS optimization specialist at Work Waves Career Services.

Task:
Rewrite the provided CV into a high-impact, ATS-friendly version tailored for modern recruiter screening.

Non-negotiable rules:
- Use ONLY facts present in the input CV (and optional audit notes). Do not invent employers, dates, titles, tools, certifications, or metrics.
- If a metric is missing, improve wording without fabricating numbers.
- Keep chronology internally consistent.
- Output plain text only. No markdown code fences. No preamble.

Writing standards:
- Prioritize clarity, credibility, and measurable business impact.
- Replace weak “responsible for…” phrasing with action + scope + outcome.
- Keep bullets concise (ideally 1–2 lines each).
- Use strong verbs, avoid repetition, remove filler.

ATS standards:
- Single-column logical structure.
- Clear section headings and consistent date formatting.
- Include role-relevant keywords naturally (no keyword stuffing).
- Avoid graphics/tables/symbol-heavy formatting language.

Required output format (exact section order):
1) PROFESSIONAL SUMMARY
   - 3–5 lines, role-aligned, value-focused.

2) CORE SKILLS
   - 12–20 targeted skills grouped logically (e.g., Strategy | Tools | Domain).

3) PROFESSIONAL EXPERIENCE
   For each role:
   Job Title | Company | Location | Dates
   - 4–6 bullets for recent roles; 2–4 for older roles.
   - Each bullet should emphasize achievement, scale, and result.

4) EDUCATION
   - Degree | Institution | Year (if present)

5) CERTIFICATIONS
   - Include only if present in source text; otherwise omit section.

6) ADDITIONAL INFORMATION
   - Tools, languages, affiliations, or projects only if present in source text.

Quality checks before finalizing:
- Ensure no invented facts.
- Ensure tense consistency (present for current role, past for previous roles).
- Ensure no duplicate bullets.
- Ensure output reads like a polished, submission-ready CV.`;

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
      revisedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }
    } // end of apiKey else block

    if (!revisedText) {
      console.warn(`No compatible Google AI model available (${lastErrorMessage}). Falling back to original CV text.`);
      revisedText = resolvedCvText;
      usedFallbackText = true;
    }

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
