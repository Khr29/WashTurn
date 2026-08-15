const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { ApiError } = require('../utils/ApiError');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header.'));
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token.'));
  }
}

module.exports = { authenticate };
