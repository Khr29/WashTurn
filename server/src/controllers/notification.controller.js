const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const notificationService = require('../services/notification.service');

const registerToken = asyncHandler(async (req, res) => {
  const { token, platform } = req.body;
  if (!token || !['ios', 'android'].includes(platform)) {
    throw new ApiError(400, 'token and a valid platform (ios|android) are required.');
  }
  await notificationService.registerToken({ userId: req.user.id, token, platform });
  res.status(204).send();
});

const unregisterToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new ApiError(400, 'token is required.');
  await notificationService.unregisterToken(req.user.id, token);
  res.status(204).send();
});

const getPreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationService.getPreferences(req.user.id);
  res.json({ preferences });
});

const updatePreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationService.updatePreferences(req.user.id, req.body || {});
  res.json({ preferences });
});

module.exports = { registerToken, unregisterToken, getPreferences, updatePreferences };
