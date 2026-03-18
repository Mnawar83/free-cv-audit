const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const FALLBACK_OPENAI_MODELS = ['gpt-4o-mini'];

function getOpenAiModel() {
  const configuredModel = (process.env.OPENAI_MODEL || '').trim();
  return configuredModel || DEFAULT_OPENAI_MODEL;
}

function getOpenAiCandidateModels() {
  const primaryModel = getOpenAiModel();
  return [primaryModel, ...FALLBACK_OPENAI_MODELS.filter((model) => model !== primaryModel)];
}

function buildOpenAiUrl(apiKey) {
  if (!apiKey) {
    throw new Error('OpenAI API key is missing.');
  }
  return OPENAI_API_URL;
}

function extractOpenAiText(result) {
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('\n')
      .trim();
  }
  return '';
}

module.exports = {
  OPENAI_API_URL,
  DEFAULT_OPENAI_MODEL,
  FALLBACK_OPENAI_MODELS,
  getOpenAiModel,
  getOpenAiCandidateModels,
  buildOpenAiUrl,
  extractOpenAiText,
};
