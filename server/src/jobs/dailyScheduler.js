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

// Runs once per hour. Because households can be in different timezones, each
// household's own local hour is checked rather than relying on a single global
// trigger time — this keeps "midnight" and "8am" meaningful per-household.
async function runHourlyCheck() {
  const households = await Household.find();

  for (const household of households) {
    const hour = getHouseholdHour(household.timezone);
    const { dateString, dayOfWeek } = getHouseholdDateParts(household.timezone);

    if (hour === 0) {
      // eslint-disable-next-line no-await-in-loop
      await expireStaleTurns(household._id, dateString);
    }

    if (hour === REMINDER_HOUR) {
      // eslint-disable-next-line no-await-in-loop
      await sendReminders(household, dateString, dayOfWeek);
    }
  }
}

async function expireStaleTurns(householdId, todayDateString) {
  const staleTurns = await Turn.find({
    householdId,
    date: { $lt: todayDateString },
    status: { $in: ['PENDING', 'RELEASED'] },
  });
  for (const turn of staleTurns) {
    // eslint-disable-next-line no-await-in-loop
    await turnService.expireStaleTurn(turn);
  }
}

async function sendReminders(household, todayDateString, dayOfWeek) {
  const schedule = await Schedule.findOne({ householdId: household._id });
  if (!schedule) return;

  // With multiple turns per day now possible, "today's turn" means whichever
  // one is still open — a household can have earlier completed turns on the
  // same date, and .findOne would not otherwise guarantee picking the live one.
  const todayTurn = await Turn.findOne({
    householdId: household._id,
    date: todayDateString,
    status: { $in: OPEN_TURN_STATUSES },
  }).sort({ createdAt: -1 });
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
