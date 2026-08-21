const Schedule = require('../models/Schedule');
const { ApiError } = require('../utils/ApiError');
const realtimeService = require('./realtime.service');

async function getSchedule(householdId) {
  const schedule = await Schedule.findOne({ householdId });
  if (!schedule) {
    throw new ApiError(404, 'Schedule not found for this household.');
  }
  return schedule;
}

async function replaceSchedule(household, days) {
  if (!Array.isArray(days) || days.length !== 7) {
    throw new ApiError(400, 'Schedule must contain exactly 7 day entries.');
  }

  const dayNumbers = new Set(days.map((d) => d.dayOfWeek));
  if (dayNumbers.size !== 7 || [...dayNumbers].some((n) => n < 0 || n > 6)) {
    throw new ApiError(400, 'Schedule must contain one entry for each day 0-6.');
  }

  const memberIds = new Set(household.members.map((m) => m.userId.toString()));
  for (const day of days) {
    if (!memberIds.has(day.userId)) {
      throw new ApiError(400, `User ${day.userId} is not a member of this household.`);
    }
  }

  const schedule = await Schedule.findOneAndUpdate(
    { householdId: household._id },
    { days },
    { new: true, upsert: true }
  );
  await realtimeService.emitHouseholdUpdated(household._id);
  return schedule;
}

// Returns the userId scheduled for the given dayOfWeek (0=Sun..6=Sat), or null.
function getScheduledUserId(schedule, dayOfWeek) {
  const entry = schedule.days.find((d) => d.dayOfWeek === dayOfWeek);
  return entry ? entry.userId : null;
}

module.exports = { getSchedule, replaceSchedule, getScheduledUserId };
