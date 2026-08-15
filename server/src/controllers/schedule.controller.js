const { asyncHandler } = require('../utils/asyncHandler');
const scheduleService = require('../services/schedule.service');

const getSchedule = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.getSchedule(req.household._id);
  res.json({ schedule });
});

const updateSchedule = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.replaceSchedule(req.household, req.body.days);
  res.json({ schedule });
});

module.exports = { getSchedule, updateSchedule };
