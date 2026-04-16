const { createRunId, linkRunToUser, upsertRun } = require('./run-store');
const { badRequest, parseJsonBody } = require('./http-400');
const { getUserIdFromSessionCookie } = require('./user-session-auth');

exports.handler = async (event) => {
  const functionName = 'init-run';
  const route = '/.netlify/functions/init-run';
  try { require('@netlify/blobs').connectLambda(event); } catch (e) {}

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const parsed = parseJsonBody(event, { functionName, route });
  if (!parsed.ok) return parsed.response;
  const parsedBody = parsed.body;

  try {
    const cvText = String(
      parsedBody?.cvText
      || parsedBody?.cv_text
      || parsedBody?.text
      || ''
    );
    if (!cvText || cvText.trim().length < 50) {
      return badRequest({
        event,
        functionName,
        route,
        message: 'Missing cvText (minimum 50 characters required).',
        payload: parsedBody,
        missingFields: ['cvText'],
        invalidFields: ['cvText'],
      });
    }

    const runId = createRunId();
    await upsertRun(runId, {
      original_cv_text: cvText,
      teaser_audit_status: 'teaser_audit_ready',
      fulfillment_status: 'payment_pending',
      audit_preview_initialized_at: new Date().toISOString(),
      teaser_audit_ready_at: new Date().toISOString(),
    });
    const userId = getUserIdFromSessionCookie(event);
    if (userId) {
      try {
        await linkRunToUser(userId, runId);
      } catch (error) {
        console.warn('Unable to link run to user session.', { runId, userId, error: error?.message || error });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
