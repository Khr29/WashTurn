const { ApiError } = require('../utils/ApiError');
const { nodeEnv } = require('../config/env');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate value violates a unique constraint.' });
  }

  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  if (statusCode >= 500) {
    console.error(err);
  }

  // Below 500, err.message is always an ApiError message a developer wrote
  // for this exact response — safe to show. At/above 500, err is an
  // unexpected failure (a driver error, a bug, etc.) whose message can
  // contain internals (stack fragments, connection strings, file paths) —
  // outside of dev/test, collapse it to a generic message instead.
  const message =
    statusCode < 500 || nodeEnv !== 'production' ? err.message || 'Internal server error' : 'Internal server error';
  res.status(statusCode).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
