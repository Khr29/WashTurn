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
    // Pinning the algorithm defends against algorithm-confusion attacks
    // (e.g. an attacker crafting an "alg": "none" or RS256-signed token to
    // bypass HMAC verification) — jwt.verify without this option will accept
    // any algorithm the library supports, not just the one this API issues.
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token.'));
  }
}

module.exports = { authenticate };
