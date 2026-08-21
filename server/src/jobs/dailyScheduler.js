const cron = require('node-cron');
const Household = require('../models/Household');
const Schedule = require('../models/Schedule');
const Turn = require('../models/Turn');
const { OPEN_TURN_STATUSES } = require('../models/Turn');
const turnService = require('../services/turn.service');
const notificationService = require('../services/notification.service');
const { getHouseholdDateParts, getHouseholdHour } = require('../utils/dateHelpers');
const { getScheduledUserId } = require('../services/schedule.service');

const REMINDER_HOUR = 8; // 8am household-local time

// Runs once per hour. finalizeExpiredTurns is real-time-driven (a slot ends
// whenever its own endAt says so, not at any particular local hour) so it
// runs on every tick for every household — this is purely a backstop for a
// household nobody happens to be actively reading right now; getCurrentTurn
// already finalizes lazily on read (see turn.service.js), which is what
// actually guarantees a slot ending is reflected immediately for anyone
// looking. Reminders remain hour-gated since "today"/"tomorrow" is still a
// per-household local-time concept independent of the turn model.
async function runHourlyCheck() {
  const households = await Household.find();

  for (const household of households) {
    // eslint-disable-next-line no-await-in-loop
    await finalizeExpiredTurn(household._id);

    const hour = getHouseholdHour(household.timezone);
    if (hour === REMINDER_HOUR) {
      const { dateString, dayOfWeek } = getHouseholdDateParts(household.timezone);
      // eslint-disable-next-line no-await-in-loop
      await sendReminders(household, dateString, dayOfWeek);
    }
  }
}

async function finalizeExpiredTurn(householdId) {
  const openTurn = await Turn.findOne({ householdId, status: { $in: OPEN_TURN_STATUSES } });
  if (openTurn) {
    await turnService.finalizeIfExpired(openTurn);
  }
}

async function sendReminders(household, todayDateString, dayOfWeek) {
  const schedule = await Schedule.findOne({ householdId: household._id });
  if (!schedule) return;

  // At most one open turn exists per household at all (see Turn's index) —
  // no date filter needed, and none would be safe to add: an overnight slot
  // still open today legitimately has yesterday's date in its `date` field.
  const todayTurn = await Turn.findOne({ householdId: household._id, status: { $in: OPEN_TURN_STATUSES } });
  if (todayTurn && todayTurn.status === 'PENDING') {
    await notificationService.notifyTurnReminder(todayTurn, 'today');
  }

  const tomorrowUserId = getScheduledUserId(schedule, (dayOfWeek + 1) % 7);
  if (tomorrowUserId) {
    await notificationService.notifyTurnReminder({ scheduledUserId: tomorrowUserId }, 'tomorrow');
  }
}

function startDailyScheduler() {
  cron.schedule('5 * * * *', () => {
    runHourlyCheck().catch((err) => console.error('dailyScheduler failed:', err));
  });
}

module.exports = { startDailyScheduler, runHourlyCheck };
