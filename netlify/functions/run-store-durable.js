const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'run-store';
const STORE_KEY = 'state';

function jsonResponse(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  };
}

function getHeader(headers, key) {
  return headers?.[key] || headers?.[key.toLowerCase()] || headers?.[key.toUpperCase()];
}

exports.handler = async function handler(event) {
  const requiredToken = process.env.RUN_STORE_DURABLE_TOKEN;
  if (requiredToken) {
    const authHeader = getHeader(event.headers, 'Authorization');
    if (!authHeader || authHeader !== `Bearer ${requiredToken}`) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }
  }

  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    try {
      const result = await store.getWithMetadata(STORE_KEY, { type: 'json' });
      if (!result) {
        return jsonResponse(404, { error: 'Not Found' });
      }

      const { data, etag } = result;
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: etag,
        },
        body: JSON.stringify(data ?? {}),
      };
    } catch (error) {
      return jsonResponse(500, {
        error: 'Failed to read store.',
        details: error.message,
      });
    }
  }

  if (event.httpMethod === 'PUT') {
    let payload;
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }

    const ifMatch = getHeader(event.headers, 'If-Match');
    const ifNoneMatch = getHeader(event.headers, 'If-None-Match');

    try {
      const options = {};
      if (ifMatch) {
        options.onlyIfMatch = ifMatch;
      } else if (ifNoneMatch === '*') {
        options.onlyIfNew = true;
      }

      const result = await store.setJSON(STORE_KEY, payload, options);
      if (options.onlyIfMatch && !result.modified) {
        return jsonResponse(412, { error: 'ETag mismatch.' });
      }
      if (options.onlyIfNew && !result.modified) {
        return jsonResponse(412, { error: 'Store already exists.' });
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: result.etag,
        },
        body: JSON.stringify(payload),
      };
    } catch (error) {
      return jsonResponse(500, {
        error: 'Failed to write store.',
        details: error.message,
      });
    }
  }

  return {
    statusCode: 405,
    headers: {
      Allow: 'GET, PUT',
    },
    body: '',
  };
};
