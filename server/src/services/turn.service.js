const Turn = require('../models/Turn');
const { OPEN_TURN_STATUSES, TERMINAL_TURN_STATUSES } = require('../models/Turn');
const Machine = require('../models/Machine');
const Schedule = require('../models/Schedule');
const Household = require('../models/Household');
const TurnRequest = require('../models/TurnRequest');
const ActivityLog = require('../models/ActivityLog');
const { ApiError } = require('../utils/ApiError');
const { getHouseholdDateParts } = require('../utils/dateHelpers');
const { getScheduledUserId } = require('./schedule.service');
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

// Finds today's still-open turn if one exists, or lazily materializes a fresh
// one seeded from the weekly schedule's default owner for today. A household
// can go through any number of turns in a day (one person washing twice,
// turns changing hands, etc.) — this only ever creates a new one once the
// previous one has reached a terminal status (COMPLETED/EXPIRED), because the
// partial unique index on Turn only allows one *open* turn per household per
// date. That index is also what keeps this race-safe: if two callers race to
// create today's first turn, only one insert wins and the loser re-fetches
// the winner instead of erroring — the same convergence the old upsert gave,
// just scoped to "open" turns instead of the whole date.
async function getOrCreateTodayTurn(household) {
  const machine = await Machine.findOne({ householdId: household._id });
  if (!machine) {
    throw new ApiError(500, 'Household is missing its machine record.');
  }

  const { dateString, dayOfWeek } = getHouseholdDateParts(household.timezone);

  const openTurn = await Turn.findOne({
    householdId: household._id,
    date: dateString,
    status: { $in: OPEN_TURN_STATUSES },
  });
  if (openTurn) return openTurn;

  const schedule = await Schedule.findOne({ householdId: household._id });
  if (!schedule) {
    throw new ApiError(500, 'Household is missing its schedule.');
  }
  const scheduledUserId = getScheduledUserId(schedule, dayOfWeek);
  if (!scheduledUserId) {
    throw new ApiError(500, 'No schedule entry found for today.');
  }

  try {
    return await Turn.create({
      householdId: household._id,
      machineId: machine._id,
      date: dateString,
      scheduledUserId,
      status: 'PENDING',
    });
  } catch (err) {
    if (err.code === 11000) {
      // Lost the race to create today's open turn — someone else's insert
      // won an instant earlier; return that one instead of erroring.
      const winner = await Turn.findOne({
        householdId: household._id,
        date: dateString,
        status: { $in: OPEN_TURN_STATUSES },
      });
      if (winner) return winner;
    }
    throw err;
  }
}

// The turn that reflects what's actually happening right now. Almost always
// this is today's open turn, but if a wash was started before midnight and
// is still IN_USE/CLAIMED when the household's calendar day rolls over, that
// unfinished turn is what's real — showing a fresh PENDING turn for the new
// date instead would make the machine look AVAILABLE while it's still
// physically running. expireStaleTurn deliberately never touches IN_USE/
// CLAIMED turns (a wash is never auto-terminated), so without this check
// such a turn would become permanently invisible once the date rolls over.
async function getCurrentTurn(household) {
  const activeCarryover = await Turn.findOne({
    householdId: household._id,
    status: { $in: ['CLAIMED', 'IN_USE'] },
  }).sort({ date: -1, createdAt: -1 });

  if (activeCarryover) return activeCarryover;

  return getOrCreateTodayTurn(household);
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

  // Releasing hands the opportunity to someone else — the scheduled user
  // can't turn around and reclaim their own released turn. This is folded
  // into the atomic condition itself (scheduledUserId: $ne) so it can't be
  // raced, not just checked ahead of time.
  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'RELEASED', scheduledUserId: { $ne: userId } },
    { $set: { status: 'CLAIMED', actingUserId: userId, type: 'EMERGENCY' } },
    { new: true }
  );

  if (!updated) {
    if (existing.scheduledUserId.toString() === userId) {
      throw new ApiError(403, 'You released this turn and cannot reclaim it yourself.');
    }
    throw new ApiError(409, 'This turn is no longer available to claim.');
  }

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

// Direct give/transfer: the current owner hands the turn to a specific
// household member. Guarded the same way as claimTurn's race guard — the
// atomicity of the single findOneAndUpdate (matched on the caller still
// being the owner, and the turn still being open) is what makes this safe
// against a concurrent transfer/accept for the same turn, not the earlier
// existence check.
async function transferTurn(turnId, fromUserId, toUserId) {
  const existing = await findTurnOrThrow(turnId);

  if (toUserId === fromUserId) {
    throw new ApiError(400, 'Cannot transfer a turn to yourself.');
  }

  const household = await Household.findById(existing.householdId);
  if (!household || !household.isMember(toUserId)) {
    throw new ApiError(400, 'That user is not a member of this household.');
  }

  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, scheduledUserId: fromUserId, status: { $nin: TERMINAL_TURN_STATUSES } },
    { $set: { scheduledUserId: toUserId } },
    { new: true }
  );

  if (!updated) {
    if (TERMINAL_TURN_STATUSES.includes(existing.status)) {
      throw new ApiError(409, 'This turn has already finished and cannot be transferred.');
    }
    throw new ApiError(403, 'Only the current owner of this turn can transfer it.');
  }

  await cancelPendingRequestsFor(turnId);
  await logActivity(updated, fromUserId, 'TRANSFERRED', 'Turn given to another member.');
  await notificationService.notifyTurnTransferred(updated, fromUserId, toUserId);

  return updated;
}

async function cancelPendingRequestsFor(turnId, exceptRequestId = null) {
  const filter = { turnId, status: 'PENDING' };
  if (exceptRequestId) filter._id = { $ne: exceptRequestId };
  await TurnRequest.updateMany(filter, { $set: { status: 'CANCELLED', resolvedAt: new Date() } });
}

// Called when a member is removed from a household — otherwise their pending
// requests linger forever: still shown to turn owners as "Incoming requests"
// from someone who can no longer be granted the turn (acceptTurnRequest's
// membership re-check above would reject it anyway), and still blocking that
// user from opening a fresh request on the same turn if they're re-invited.
async function cancelPendingRequestsFromUser(householdId, requesterId) {
  await TurnRequest.updateMany(
    { householdId, requesterId, status: 'PENDING' },
    { $set: { status: 'CANCELLED', resolvedAt: new Date() } }
  );
}

// Requesting someone's turn is intentionally decoupled from Turn.status — it
// must be possible even while the machine is IN_USE, since the owner may
// only be able to respond once their current wash is done.
async function createTurnRequest(turnId, requesterId) {
  const turn = await findTurnOrThrow(turnId);

  if (TERMINAL_TURN_STATUSES.includes(turn.status)) {
    throw new ApiError(409, 'This turn has already finished.');
  }
  if (turn.scheduledUserId.toString() === requesterId) {
    throw new ApiError(400, 'You already own this turn.');
  }

  let request;
  try {
    request = await TurnRequest.create({ householdId: turn.householdId, turnId, requesterId });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'You already have a pending request for this turn.');
    }
    throw err;
  }

  await notificationService.notifyTurnRequested(turn, requesterId);
  return request;
}

async function listTurnRequests(turnId) {
  return TurnRequest.find({ turnId }).sort({ createdAt: -1 });
}

// The one transition requiring the same kind of concurrency guard as
// claimTurn/transferTurn: two pending requests being accepted nearly
// simultaneously, or an accept racing a direct transfer. The request is
// flipped to ACCEPTED first (atomically, guarded on it still being PENDING),
// then the turn's ownership is reassigned (atomically, guarded on the caller
// still being the owner and the turn still being open). If the second step
// loses its race, the request flip is rolled back and the caller gets a 409
// — the turn is never left owned by two people, and a request is never left
// ACCEPTED without the ownership change actually having happened.
async function acceptTurnRequest(turnId, requestId, ownerId) {
  const turn = await findTurnOrThrow(turnId);
  const request = await TurnRequest.findById(requestId);
  if (!request || request.turnId.toString() !== turnId.toString()) {
    throw new ApiError(404, 'Request not found.');
  }

  if (turn.scheduledUserId.toString() !== ownerId) {
    throw new ApiError(403, 'Only the current owner of this turn can accept requests for it.');
  }

  // A request can sit PENDING indefinitely, so the requester may have been
  // removed from the household after requesting and before this accept —
  // re-check membership now rather than trusting the request's mere
  // existence, otherwise accepting it would hand turn ownership to someone
  // no longer in the household.
  const household = await Household.findById(turn.householdId);
  if (!household || !household.isMember(request.requesterId)) {
    throw new ApiError(409, 'The requester is no longer a member of this household.');
  }

  const acceptedRequest = await TurnRequest.findOneAndUpdate(
    { _id: requestId, status: 'PENDING' },
    { $set: { status: 'ACCEPTED', resolvedAt: new Date() } },
    { new: true }
  );
  if (!acceptedRequest) {
    throw new ApiError(409, 'This request is no longer pending.');
  }

  const updatedTurn = await Turn.findOneAndUpdate(
    { _id: turnId, scheduledUserId: ownerId, status: { $nin: TERMINAL_TURN_STATUSES } },
    { $set: { scheduledUserId: acceptedRequest.requesterId } },
    { new: true }
  );

  if (!updatedTurn) {
    await TurnRequest.findByIdAndUpdate(requestId, { $set: { status: 'PENDING', resolvedAt: null } });
    throw new ApiError(409, 'This turn changed hands before the request could be accepted.');
  }

  await cancelPendingRequestsFor(turnId, requestId);
  await logActivity(updatedTurn, ownerId, 'TRANSFERRED', 'Turn request accepted; ownership transferred.');
  await notificationService.notifyRequestAccepted(updatedTurn, acceptedRequest.requesterId.toString());

  return { turn: updatedTurn, request: acceptedRequest };
}

async function rejectTurnRequest(turnId, requestId, ownerId) {
  const turn = await findTurnOrThrow(turnId);
  if (turn.scheduledUserId.toString() !== ownerId) {
    throw new ApiError(403, 'Only the current owner of this turn can reject requests for it.');
  }

  const request = await TurnRequest.findOneAndUpdate(
    { _id: requestId, turnId, status: 'PENDING' },
    { $set: { status: 'REJECTED', resolvedAt: new Date() } },
    { new: true }
  );
  if (!request) {
    throw new ApiError(409, 'This request is no longer pending.');
  }

  await notificationService.notifyRequestRejected(turn, request.requesterId.toString());
  return request;
}

async function cancelTurnRequest(turnId, requestId, requesterId) {
  const request = await TurnRequest.findOneAndUpdate(
    { _id: requestId, turnId, requesterId, status: 'PENDING' },
    { $set: { status: 'CANCELLED', resolvedAt: new Date() } },
    { new: true }
  );
  if (!request) {
    throw new ApiError(409, 'This request is no longer pending, or is not yours to cancel.');
  }
  return request;
}

module.exports = {
  getOrCreateTodayTurn,
  getCurrentTurn,
  findTurnOrThrow,
  startTurn,
  releaseTurn,
  claimTurn,
  finishTurn,
  expireStaleTurn,
  transferTurn,
  createTurnRequest,
  listTurnRequests,
  acceptTurnRequest,
  rejectTurnRequest,
  cancelTurnRequest,
  cancelPendingRequestsFromUser,
};
