const Turn = require('../models/Turn');
const Machine = require('../models/Machine');
const Schedule = require('../models/Schedule');
const ActivityLog = require('../models/ActivityLog');
const { ApiError } = require('../utils/ApiError');
const { getHouseholdDateParts } = require('../utils/dateHelpers');
const { getScheduledUserId } = require('./schedule.service');
const { syncMachineFromTurn } = require('./machine.service');
const notificationService = require('./notification.service');

async function logActivity(turn, userId, type, summary) {
  await ActivityLog.create({
    householdId: turn.householdId,
    turnId: turn._id,
    userId,
    type,
    summary,
  });
}

// Lazily materializes today's Turn for a household. Safe under concurrent callers:
// the unique (householdId, date) index means only one insert can ever win, and the
// upsert makes concurrent callers converge on the same document instead of erroring.
async function getOrCreateTodayTurn(household) {
  const machine = await Machine.findOne({ householdId: household._id });
  if (!machine) {
    throw new ApiError(500, 'Household is missing its machine record.');
  }

  const schedule = await Schedule.findOne({ householdId: household._id });
  if (!schedule) {
    throw new ApiError(500, 'Household is missing its schedule.');
  }

  const { dateString, dayOfWeek } = getHouseholdDateParts(household.timezone);
  const scheduledUserId = getScheduledUserId(schedule, dayOfWeek);
  if (!scheduledUserId) {
    throw new ApiError(500, 'No schedule entry found for today.');
  }

  const turn = await Turn.findOneAndUpdate(
    { householdId: household._id, date: dateString },
    { $setOnInsert: { machineId: machine._id, scheduledUserId, status: 'PENDING' } },
    { new: true, upsert: true }
  );

  return turn;
}

async function findTurnOrThrow(turnId) {
  const turn = await Turn.findById(turnId);
  if (!turn) {
    throw new ApiError(404, 'Turn not found.');
  }
  return turn;
}

async function startTurn(turnId, userId, { estimatedDurationMinutes } = {}) {
  const existing = await findTurnOrThrow(turnId);

  // Branch 1: the scheduled user starting their normal turn.
  let updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'PENDING', scheduledUserId: userId },
    {
      $set: {
        status: 'IN_USE',
        actingUserId: userId,
        type: 'NORMAL',
        startedAt: new Date(),
        estimatedDurationMinutes: estimatedDurationMinutes ?? null,
      },
    },
    { new: true }
  );

  // Branch 2: an emergency user who already claimed the released turn.
  if (!updated) {
    updated = await Turn.findOneAndUpdate(
      { _id: turnId, status: 'CLAIMED', actingUserId: userId },
      {
        $set: {
          status: 'IN_USE',
          startedAt: new Date(),
          estimatedDurationMinutes: estimatedDurationMinutes ?? null,
        },
      },
      { new: true }
    );
  }

  if (!updated) {
    if (existing.status !== 'PENDING' && existing.status !== 'CLAIMED') {
      throw new ApiError(409, `Turn cannot be started from status ${existing.status}.`);
    }
    throw new ApiError(403, 'You are not authorized to start this turn.');
  }

  await syncMachineFromTurn(existing.householdId, updated);
  await logActivity(updated, userId, 'STARTED', `${updated.type === 'EMERGENCY' ? 'Emergency' : 'Scheduled'} wash started.`);
  await notificationService.notifyTurnStarted(updated);

  return updated;
}

async function releaseTurn(turnId, userId) {
  const existing = await findTurnOrThrow(turnId);

  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'PENDING', scheduledUserId: userId },
    { $set: { status: 'RELEASED', releasedAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    if (existing.status !== 'PENDING') {
      throw new ApiError(409, `Turn cannot be released from status ${existing.status}.`);
    }
    throw new ApiError(403, 'Only the scheduled user can release this turn.');
  }

  await syncMachineFromTurn(existing.householdId, updated);
  await logActivity(updated, userId, 'RELEASED', 'Scheduled turn released for emergency use.');
  await notificationService.notifyTurnReleased(updated);

  return updated;
}

// The one transition requiring a genuine concurrency guard: two members may hit
// /claim for the same released turn at nearly the same instant. The atomicity of
// this single findOneAndUpdate — matched on status:'RELEASED' — is the guard; only
// the request that observes the still-RELEASED document can flip it to CLAIMED, and
// Mongo serializes concurrent writes to the same document so exactly one wins.
async function claimTurn(turnId, userId) {
  const existing = await findTurnOrThrow(turnId);

  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'RELEASED' },
    { $set: { status: 'CLAIMED', actingUserId: userId, type: 'EMERGENCY' } },
    { new: true }
  );

  if (!updated) {
    throw new ApiError(409, 'This turn is no longer available to claim.');
  }

  await syncMachineFromTurn(existing.householdId, updated);
  await logActivity(updated, userId, 'CLAIMED', 'Emergency turn claimed.');
  await notificationService.notifyEmergencyClaimed(updated);

  return updated;
}

async function finishTurn(turnId, userId) {
  const existing = await findTurnOrThrow(turnId);

  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'IN_USE', actingUserId: userId },
    { $set: { status: 'COMPLETED', finishedAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    if (existing.status !== 'IN_USE') {
      throw new ApiError(409, `Turn cannot be finished from status ${existing.status}.`);
    }
    throw new ApiError(403, 'Only the person currently using the machine can finish this turn.');
  }

  await syncMachineFromTurn(existing.householdId, updated);
  await logActivity(updated, userId, 'COMPLETED', 'Wash completed.');
  await notificationService.notifyTurnFinished(updated);

  return updated;
}

// Called by the daily cron: any turn still RELEASED (never claimed) or PENDING
// (never acted on) from a previous day is closed out so the new day's turn can
// be materialized cleanly.
async function expireStaleTurn(turn) {
  const updated = await Turn.findOneAndUpdate(
    { _id: turn._id, status: { $in: ['PENDING', 'RELEASED'] } },
    { $set: { status: 'EXPIRED' } },
    { new: true }
  );
  if (updated) {
    await logActivity(updated, updated.scheduledUserId, 'EXPIRED', 'Turn expired unused.');
  }
  return updated;
}

module.exports = {
  getOrCreateTodayTurn,
  findTurnOrThrow,
  startTurn,
  releaseTurn,
  claimTurn,
  finishTurn,
  expireStaleTurn,
};
