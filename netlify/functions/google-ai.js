const DEFAULT_GOOGLE_AI_MODEL = 'gemini-3.1-pro';
const FALLBACK_GOOGLE_AI_MODELS = ['gemini-3.1-flash'];

function getGoogleAiModel() {
  const configuredModel = (process.env.GOOGLE_AI_MODEL || '').trim();
  return configuredModel || DEFAULT_GOOGLE_AI_MODEL;
}

function getGoogleAiCandidateModels() {
  const primaryModel = getGoogleAiModel();
  return [primaryModel, ...FALLBACK_GOOGLE_AI_MODELS.filter((model) => model !== primaryModel)];
}

function buildGoogleAiUrl(apiKey, modelOverride) {
  if (!apiKey) {
    throw new Error('Google AI API key is missing.');
  }
  const model = modelOverride || getGoogleAiModel();
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

module.exports = {
  DEFAULT_GOOGLE_AI_MODEL,
  FALLBACK_GOOGLE_AI_MODELS,
  getGoogleAiModel,
  getGoogleAiCandidateModels,
  buildGoogleAiUrl,
};
