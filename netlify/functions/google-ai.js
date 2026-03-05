const GOOGLE_AI_MODEL = 'gemini-3.1-pro-preview';

function buildGoogleAiUrl(apiKey) {
  if (!apiKey) {
    throw new Error('Google AI API key is missing.');
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_AI_MODEL}:generateContent?key=${apiKey}`;
}

module.exports = {
  GOOGLE_AI_MODEL,
  buildGoogleAiUrl,
};
