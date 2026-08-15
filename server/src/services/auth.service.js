const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, jwtExpiresIn } = require('../config/env');
const { ApiError } = require('../utils/ApiError');

const SALT_ROUNDS = 10;

function issueToken(user) {
  return jwt.sign({}, jwtSecret, { subject: user._id.toString(), expiresIn: jwtExpiresIn });
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

module.exports = { register, login, toPublicUser };
