const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, jwtExpiresIn } = require('../config/env');
const { ApiError } = require('../utils/ApiError');

const SALT_ROUNDS = 10;

function issueToken(user) {
  return jwt.sign({}, jwtSecret, { subject: user._id.toString(), expiresIn: jwtExpiresIn, algorithm: 'HS256' });
}

function toPublicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email };
}

async function register({ name, email, password }) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await User.create({ name, email: email.toLowerCase(), passwordHash });

  return { user: toPublicUser(user), token: issueToken(user) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  return { user: toPublicUser(user), token: issueToken(user) };
}

// Reissues a fresh, full-lifetime token for an already-authenticated caller
// (the `authenticate` middleware already proved the current token is valid
// before this runs). This is the sliding-renewal half of "stay logged in
// indefinitely without weakening JWT_EXPIRES_IN": rather than issuing a
// long-lived token up front (which would mean a stolen/lost token stays
// valid just as long), the client calls this on every app-start session
// restore, so an *active* user's token never actually gets close to
// expiring, while a token that genuinely goes unused still expires on
// schedule. Same as /me plus a new token — kept as a separate endpoint
// rather than folded into /me so /me's response shape (used elsewhere)
// doesn't change.
async function refresh(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(401, 'User no longer exists.');
  }
  return { user: toPublicUser(user), token: issueToken(user) };
}

module.exports = { register, login, refresh, toPublicUser };
