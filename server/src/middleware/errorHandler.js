const { ApiError } = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate value violates a unique constraint.' });
  }

  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  if (statusCode >= 500) {
    console.error(err);
  }
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
}

module.exports = { notFoundHandler, errorHandler };
