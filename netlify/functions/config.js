function isTruthy(value) {
  return String(value || '').trim().length > 0;
}

function assertEnvVars(requiredNames = [], context = 'function') {
  const missing = requiredNames.filter((name) => !isTruthy(process.env[name]));
  if (missing.length) {
    throw new Error(`[config] Missing required environment variables for ${context}: ${missing.join(', ')}`);
  }
}

module.exports = {
  assertEnvVars,
};
