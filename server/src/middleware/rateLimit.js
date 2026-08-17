const rateLimit = require('express-rate-limit');
const { nodeEnv } = require('../config/env');

// Rate limiting is meaningless (and actively annoying) against Jest's
// supertest requests, which all originate from the same in-process "IP" and
// routinely fire far more than any human-facing limit below in a single
// test run. Disabled only for automated tests, not for local dev, so manual
// testing still exercises the real limits.
const disabled = nodeEnv === 'test';

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled,
    handler: (req, res) => {
      res.status(429).json({ error: message });
    },
  });
}

// Login/registration: the classic credential-stuffing / brute-force target.
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again later.',
});

// Invite codes are 6 alphanumeric characters (~1.07e9 combinations) — not
// brute-forceable one-by-one over the network, but this closes off scripted
// guessing entirely rather than relying on the keyspace alone.
const joinHouseholdLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many join attempts. Please try again later.',
});

// Turn requests / drying requests: cheap to create, and repeated creation
// spams other members with notifications, so it's worth bounding even though
// it's not a classic "attack" endpoint.
const requestCreationLimiter = makeLimiter({
  windowMs: 5 * 60 * 1000,
  max: 60,
  message: 'Too many requests created in a short time. Please slow down.',
});

module.exports = { authLimiter, joinHouseholdLimiter, requestCreationLimiter };
