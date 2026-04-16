function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function sanitizeHeaders(headers = {}) {
  const normalized = {};
  Object.keys(headers || {}).forEach((key) => {
    normalized[String(key || '').toLowerCase()] = headers[key];
  });
  return normalized;
}

function getCorrelationId(event = {}) {
  const headers = sanitizeHeaders(event.headers || {});
  return String(
    headers['x-correlation-id']
    || headers['x-request-id']
    || headers['x-nf-request-id']
    || event.requestContext?.requestId
    || event.requestContext?.request_id
    || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  ).trim();
}

function getContentType(event = {}) {
  const headers = sanitizeHeaders(event.headers || {});
  return String(headers['content-type'] || '').trim().toLowerCase();
}

function getPayloadKeys(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.keys(payload);
}

function badRequest({ event, functionName, route, message, payload, missingFields = [], invalidFields = [] }) {
  const contentType = getContentType(event);
  const correlationId = getCorrelationId(event);
  const safeRoute = route || event?.path || event?.rawUrl || 'unknown';

  console.warn('[http-400]', {
    functionName,
    route: safeRoute,
    contentType: contentType || 'missing',
    payloadKeys: getPayloadKeys(payload),
    missingFields,
    invalidFields,
    correlationId,
    message,
  });

  return json(400, {
    error: message,
    correlationId,
  });
}

function parseJsonBody(event, { functionName, route }) {
  const contentType = getContentType(event);
  const allowsJson = contentType.includes('application/json') || contentType === '';
  if (!allowsJson) {
    return {
      ok: false,
      response: badRequest({
        event,
        functionName,
        route,
        message: 'Unsupported Content-Type. Expected application/json.',
        invalidFields: ['content-type'],
      }),
    };
  }

  try {
    return { ok: true, body: JSON.parse(event.body || '{}') };
  } catch (_error) {
    return {
      ok: false,
      response: badRequest({
        event,
        functionName,
        route,
        message: 'Invalid JSON body.',
      }),
    };
  }
}

module.exports = {
  badRequest,
  getContentType,
  getCorrelationId,
  parseJsonBody,
};
