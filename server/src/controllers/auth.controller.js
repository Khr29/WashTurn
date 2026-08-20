const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const authService = require('../services/auth.service');
const User = require('../models/User');

const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  // Type-checked, not just truthiness — a non-string body value (an object,
  // array, or number all pass `!value`) would otherwise reach bcrypt/Mongoose
  // and crash with a raw TypeError (500) instead of a clean validation error.
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'name, email, and password are required.');
  }
  if (!name || !email || !password) {
    throw new ApiError(400, 'name, email, and password are required.');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  const result = await authService.register({ name, email, password });
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new ApiError(400, 'email and password are required.');
  }

  const result = await authService.login({ email, password });
  res.json(result);
});

// JWTs are stateless (§ Decisions Needed: single long-lived token, no refresh/blacklist
// flow for v1) — logout is a client-side token discard. This endpoint exists for a
// consistent API surface and a hook point if server-side revocation is added later.
const logout = asyncHandler(async (req, res) => {
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(401, 'User no longer exists.');
  res.json({ user: authService.toPublicUser(user) });
});

module.exports = { register, login, logout, me };
