const { asyncHandler } = require('../utils/asyncHandler');
const activityService = require('../services/activity.service');

const getActivity = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const result = await activityService.getActivity(req.household._id, { page, limit });
  res.json(result);
});

module.exports = { getActivity };
