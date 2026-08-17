require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = required('JWT_SECRET');

// A short/default JWT secret is a total auth bypass (anyone can forge tokens),
// so it's worth failing loudly at startup rather than only in a security
// report nobody reads. Scoped to production only — dev/test fixtures
// intentionally use short, well-known secrets for convenience.
if (nodeEnv === 'production' && jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET is too short for production use (need at least 32 characters). ' +
      'Generate one with `openssl rand -base64 48` and set it in the production environment.'
  );
}

// Comma-separated list of browser origins allowed to call this API with
// credentials-style requests (see src/app.js). Irrelevant to the Flutter app,
// which doesn't send an Origin header — this only fences off browser-based
// callers. Empty in production by default: cross-origin browser access must
// be explicitly opted into per deployment, not assumed.
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv,
  mongoUri: required('MONGO_URI'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  defaultHouseholdTimezone: process.env.DEFAULT_HOUSEHOLD_TIMEZONE || 'UTC',
  corsOrigins,
};
