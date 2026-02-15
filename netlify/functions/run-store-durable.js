// Netlify Function: run-store-durable

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE_NAME = 'run-store';
const STORE_KEY = 'state';

function jsonResponse(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  };
}

exports.handler = async function handler(event) {
  // Initialise the Blobs environment for Functions v1
  connectLambda(event);

  const headers = event.headers || {};

  // Optional auth check
  const requiredToken = process.env.RUN_STORE_DURABLE_TOKEN;
  if (requiredToken) {
    const authHeader = headers.authorization || headers.Authorization;
    if (!authHeader || authHeader !== `Bearer ${requiredToken}`) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }
  }

  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    try {
      const result = await store.getWithMetadata(STORE_KEY, { type: 'json' });
      if (!result) return jsonResponse(404, { error: 'Not Found' });
      const { data, etag } = result;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ETag: etag },
        body: JSON.stringify(data ?? {}),
      };
    } catch (error) {
      return jsonResponse(500, { error: 'Failed to read store.', details: error.message });
    }
  }

  if (event.httpMethod === 'PUT') {
    let payload;
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }

    const ifMatch = headers['if-match'] || headers['If-Match'];
    const ifNoneMatch = headers['if-none-match'] || headers['If-None-Match'];
    try {
      const options = {};
      if (ifMatch) options.onlyIfMatch = ifMatch;
      else if (ifNoneMatch === '*') options.onlyIfNew = true;

      const result = await store.setJSON(STORE_KEY, payload, options);

      if (options.onlyIfMatch && !result?.modified) {
        return jsonResponse(412, { error: 'ETag mismatch.' });
      }
      if (options.onlyIfNew && !result?.modified) {
        return jsonResponse(412, { error: 'Store already exists.' });
      }

      // Get the ETag either from the result or by reading metadata
      let etag = result?.etag;
      if (!etag) {
        try {
          const meta = await store.getWithMetadata(STORE_KEY, { type: 'json' });
          etag = meta?.etag;
        } catch {
          // ignore if metadata is unavailable
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) },
        body: JSON.stringify(payload),
      };
    } catch (error) {
      return jsonResponse(500, { error: 'Failed to write store.', details: error.message });
    }
  }

  return { statusCode: 405, headers: { Allow: 'GET, PUT' }, body: '' };
};
