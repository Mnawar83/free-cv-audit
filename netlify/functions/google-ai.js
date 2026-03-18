const DEFAULT_GOOGLE_AI_MODEL = 'gemini-3.1-pro';

function getGoogleAiModel() {
  const configuredModel = (process.env.GOOGLE_AI_MODEL || '').trim();
  return configuredModel || DEFAULT_GOOGLE_AI_MODEL;
}

function buildGoogleAiUrl(apiKey) {
  if (!apiKey) {
    throw new Error('Google AI API key is missing.');
  }
  const model = getGoogleAiModel();
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

module.exports = {
  DEFAULT_GOOGLE_AI_MODEL,
  getGoogleAiModel,
  buildGoogleAiUrl,
};
