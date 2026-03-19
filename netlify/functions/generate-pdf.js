const { buildGoogleAiUrl, getGoogleAiCandidateModels } = require(‘./google-ai’);
const { LINKEDIN_UPSELL_STATUS, createRunId, getRun, upsertRun } = require(‘./run-store’);
const { buildPdfBuffer } = require(‘./pdf-builder’);

const PDF_FILENAME = ‘revised-cv.pdf’;

function pdfResponse(pdfBuffer, runId, inline = false) {
  const disposition = inline ? `inline; filename=”${PDF_FILENAME}”` : `attachment; filename=”${PDF_FILENAME}”`;
  return {
    statusCode: 200,
    headers: {
      ‘Content-Type’: ‘application/pdf’,
      ‘Content-Disposition’: disposition,
      ...(runId ? { ‘x-run-id’: runId } : {}),
    },
    body: pdfBuffer.toString(‘base64’),
    isBase64Encoded: true,
  };
}

exports.handler = async (event) => {
  if (!['POST', 'GET'].includes(event.httpMethod)) {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const runId = event.queryStringParameters?.runId;
      if (!runId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'runId is required.' }) };
      }
      const run = await getRun(runId);
      if (!run?.revised_cv_text) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Revised CV not found.' }) };
      }
      const pdfBuffer = buildPdfBuffer(run.revised_cv_text);
      return pdfResponse(pdfBuffer, runId, true);
    }

    const { cvText, cvAnalysis, runId: incomingRunId } = JSON.parse(event.body || '{}');
    const existingRun = incomingRunId ? await getRun(incomingRunId) : null;
    const resolvedCvText = cvText || existingRun?.original_cv_text || '';
    const resolvedCvAnalysis = cvAnalysis || existingRun?.audit_result || '';

    if (existingRun?.revised_cv_text) {
      const cachedPdfBuffer = buildPdfBuffer(existingRun.revised_cv_text);
      return pdfResponse(cachedPdfBuffer, incomingRunId);
    }
    const candidateModels = getGoogleAiCandidateModels();

    if (!resolvedCvText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;

    let result;
    let revisedText = '';
    let usedFallbackText = false;
    let lastErrorMessage = 'AI request failed';

    if (!apiKey) {
      console.warn('Google AI API key is missing. Falling back to original CV text.');
      revisedText = resolvedCvText;
      usedFallbackText = true;
    } else {
    const systemPrompt = `You are an expert CV writer for Work Waves Career Services.
Rewrite the CV for ATS compatibility and professional impact.
Return only the revised CV content, formatted as plain text with clear section headings.`;

    const analysisNote = resolvedCvAnalysis
      ? `\n\nUse this CV analysis as reference while revising:\n${resolvedCvAnalysis}`
      : '';
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: `Rewrite this CV:\n\n${resolvedCvText}${analysisNote}` }] }],
    };

    for (const model of candidateModels) {
      const apiUrl = buildGoogleAiUrl(apiKey, model);
      const fetchResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

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
          fetchResponse.status === 404 || /not found|unsupported|not available/i.test(errorMsg);
        if (modelNotAvailable) {
          lastErrorMessage = `${model}: ${errorMsg}`;
          continue;
        }

        console.warn(`AI rewrite failed (${errorMsg}). Falling back to original CV text.`);
        revisedText = resolvedCvText;
        usedFallbackText = true;
        break;
      } catch (error) {
        const errorMessage = error?.message || 'unknown';
        const modelNotAvailable = /missing|not found|unsupported|not available/i.test(errorMessage);
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

    await upsertRun(runId, runUpdates);

    return pdfResponse(pdfBuffer, runId);
  } catch (error) {
    console.error('Generate PDF failure.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
