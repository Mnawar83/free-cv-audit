const DEFAULT_GOOGLE_AI_MODEL = 'gemini-3.1-pro-preview';
const FALLBACK_GOOGLE_AI_MODELS = ['gemini-2.5-flash'];

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

const GOOGLE_AI_MODEL = getGoogleAiModel();

module.exports = {
  DEFAULT_GOOGLE_AI_MODEL,
  FALLBACK_GOOGLE_AI_MODELS,
  GOOGLE_AI_MODEL,
  getGoogleAiModel,
  getGoogleAiCandidateModels,
  buildGoogleAiUrl,
};
