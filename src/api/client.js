const baseUrl = import.meta.env.VITE_API_BASE_URL || '/.netlify/functions';

async function withRetry(request, retries = 2) {
  let error;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await request();
    } catch (err) {
      error = err;
      if (i === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw error;
}

export async function apiPost(path, payload) {
  return withRetry(async () => {
    const response = await fetch(`${baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Request failed');
    }
    return response.json();
  });
}

export async function initRun(fileName) {
  return apiPost('init-run', { fileName });
}

export async function generateAudit(runId, text) {
  return apiPost('audit', { runId, text });
}
