const Turn = require('../models/Turn');
const { OPEN_TURN_STATUSES, TERMINAL_TURN_STATUSES } = require('../models/Turn');
const Machine = require('../models/Machine');
const Schedule = require('../models/Schedule');
const Household = require('../models/Household');
const TurnRequest = require('../models/TurnRequest');
const ActivityLog = require('../models/ActivityLog');
const { ApiError } = require('../utils/ApiError');
const {
  getHouseholdDateParts,
  zonedTimeToUtc,
  addDaysToDateString,
  dayOfWeekFromDateString,
} = require('../utils/dateHelpers');
const notificationService = require('./notification.service');
const realtimeService = require('./realtime.service');

async function logActivity(turn, userId, type, summary) {
  await ActivityLog.create({
    householdId: turn.householdId,
    turnId: turn._id,
    userId,
    type,
    summary,
  });
  await realtimeService.emitActivityCreated(turn.householdId);
}

// A day's schedule entry names an owner but only optionally a startTime/
// endTime — when either is missing the slot is the whole household-local
// day (00:00 up to, but not including, the next day's 00:00). "24:00" is
// used internally as the whole-day end sentinel since Date can't represent
// a same-day 24:00 directly; it always rolls the end onto the next date.
function slotWindowForDate(entry, dateString, timezone) {
  const hasWindow = Boolean(entry.startTime && entry.endTime);
  const startTime = hasWindow ? entry.startTime : '00:00';
  const endTime = hasWindow ? entry.endTime : '24:00';

  // endTime <= startTime (lexicographic works for zero-padded "HH:mm") means
  // the slot crosses midnight, e.g. 22:00 -> 02:00 — its end lands on the
  // next calendar date. This is also what "24:00" always hits, giving the
  // whole-day case its next-midnight boundary for free.
  const crossesMidnight = endTime <= startTime;
  const endDateString = crossesMidnight ? addDaysToDateString(dateString, 1) : dateString;
  const normalizedEndTime = endTime === '24:00' ? '00:00' : endTime;

  return {
    startAt: zonedTimeToUtc(dateString, startTime, timezone),
    endAt: zonedTimeToUtc(endDateString, normalizedEndTime, timezone),
  };
}

// Finds whichever schedule slot is actually happening right now, or — if
// none is — the next one coming up. Must look further back than "today"
// alone: a slot that started yesterday (or earlier, if the household's been
// dormant) can still be the one that's current, since slots can cross
// midnight and span multiple calendar days. Starts one day back to catch
// exactly that overnight-carryover case, then steps forward one calendar day
// at a time until it reaches a slot whose endAt hasn't passed yet — that's
// either the in-progress one (now already past its startAt) or the next
// upcoming one (now still before its startAt). Bounded at 9 days, which is
// far more slack than any real gap between reads should ever need.
function resolveSlotAt(schedule, timezone, now) {
  let dateString = addDaysToDateString(getHouseholdDateParts(timezone, now).dateString, -1);

  for (let i = 0; i < 9; i += 1) {
    const dayOfWeek = dayOfWeekFromDateString(dateString);
    const entry = schedule.days.find((d) => d.dayOfWeek === dayOfWeek);
    if (entry) {
      const window = slotWindowForDate(entry, dateString, timezone);
      if (now < window.endAt) {
        return { userId: entry.userId, dateString, ...window };
      }
    }
    dateString = addDaysToDateString(dateString, 1);
  }
  throw new ApiError(500, 'Could not resolve a schedule slot for today.');
}

// Finds the household's still-open turn if one exists, or lazily
// materializes a fresh one for whichever schedule slot applies right now. A
// slot can contain any number of washes (see finishTurn) — this only ever
// creates a new turn once the previous one's slot has actually ended
// (finalizeIfExpired), because the partial unique index on Turn only allows
// one *open* turn per household, full stop. That index is also what keeps
// this race-safe: if two callers race to create the same slot's turn, only
// one insert wins and the loser re-fetches the winner instead of erroring.
async function getOrCreateCurrentSlotTurn(household, now = new Date()) {
  const machine = await Machine.findOne({ householdId: household._id });
  if (!machine) {
    throw new ApiError(500, 'Household is missing its machine record.');
  }

  const openTurn = await Turn.findOne({ householdId: household._id, status: { $in: OPEN_TURN_STATUSES } });
  if (openTurn) return openTurn;

  const schedule = await Schedule.findOne({ householdId: household._id });
  if (!schedule) {
    throw new ApiError(500, 'Household is missing its schedule.');
  }
  const slot = resolveSlotAt(schedule, household.timezone, now);

  try {
    return await Turn.create({
      householdId: household._id,
      machineId: machine._id,
      date: slot.dateString,
      startAt: slot.startAt,
      endAt: slot.endAt,
      scheduledUserId: slot.userId,
      status: 'PENDING',
    });
  } catch (err) {
    if (err.code === 11000) {
      // Lost the race to create this slot's open turn — someone else's
      // insert won an instant earlier; return that one instead of erroring.
      const winner = await Turn.findOne({ householdId: household._id, status: { $in: OPEN_TURN_STATUSES } });
      if (winner) return winner;
    }
    throw err;
  }
}

// A turn whose slot has ended (now >= endAt) is finalized regardless of what
// it was doing at that instant — mid-wash, idle, still just RELEASED,
// whatever — because the owner's window is authoritative: the next turn
// cannot become active until the current slot's end time, and symmetrically
// the current slot cannot stay "current" one instant past it. COMPLETED if
// it was ever used (startedAt set, even if the most recent wash had already
// been finished for a while), EXPIRED if it never was. Guarded on still
// being OPEN so two concurrent finalizers (a live request racing the hourly
// sweep) can't double-log/double-emit — only one findOneAndUpdate wins.
async function finalizeIfExpired(turn, now = new Date()) {
  if (now < turn.endAt) return turn;

  const nextStatus = turn.startedAt ? 'COMPLETED' : 'EXPIRED';
  const updated = await Turn.findOneAndUpdate(
    { _id: turn._id, status: { $in: OPEN_TURN_STATUSES } },
    { $set: { status: nextStatus } },
    { new: true }
  );
  if (!updated) {
    // Someone else finalized it first — return the current (terminal) doc.
    return Turn.findById(turn._id);
  }

  await logActivity(
    updated,
    updated.scheduledUserId,
    nextStatus,
    nextStatus === 'COMPLETED' ? "Turn's time slot ended." : 'Turn expired unused.'
  );
  await realtimeService.emitTurnUpdated(updated);
  return updated;
}

// The turn that reflects what's actually happening right now, determined
// purely from real time against startAt/endAt — never from calendar dates.
// If the household's current open turn's slot has ended, it's finalized here
// (lazily, on read) and the next applicable slot's turn is materialized in
// its place; the hourly cron (dailyScheduler.js) does the same thing as a
// backstop for households nobody happens to be actively reading right now.
async function getCurrentTurn(household, now = new Date()) {
  const openTurn = await Turn.findOne({ householdId: household._id, status: { $in: OPEN_TURN_STATUSES } });
  if (openTurn) {
    const settled = await finalizeIfExpired(openTurn, now);
    if (OPEN_TURN_STATUSES.includes(settled.status)) return settled;
  }
  return getOrCreateCurrentSlotTurn(household, now);
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

  // Branch 1: the scheduled user starting a wash — either their first one in
  // this slot, or another one after an earlier wash in the same slot already
  // finished (finishTurn returns to PENDING rather than ending the turn, so
  // this branch also covers every repeat wash). `existing.type` is preserved
  // rather than hardcoded so a repeat wash by an emergency claimer (who
  // becomes `scheduledUserId` on claim — see claimTurn) stays marked
  // EMERGENCY instead of flipping back to NORMAL on their second wash.
  let updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'PENDING', scheduledUserId: userId },
    {
      $set: {
        status: 'IN_USE',
        actingUserId: userId,
        type: existing.type || 'NORMAL',
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
  await realtimeService.emitTurnUpdated(updated);

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
  await realtimeService.emitTurnUpdated(updated);

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
  //
  // scheduledUserId is reassigned to the claimant here, not left as the
  // original owner — a slot now survives multiple washes (see finishTurn),
  // so ownership of the *rest* of the slot has to land somewhere concrete
  // for a repeat wash to have anyone to match against; the claimant taking
  // over the remainder (same as a direct transfer would) is that answer.
  // startAt/endAt are untouched — claiming reassigns who the slot belongs
  // to, never the slot's own boundaries.
  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'RELEASED', scheduledUserId: { $ne: userId } },
    { $set: { status: 'CLAIMED', actingUserId: userId, scheduledUserId: userId, type: 'EMERGENCY' } },
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
  await realtimeService.emitTurnUpdated(updated);

  return updated;
}

// Finishing a wash does NOT end the turn — the owner keeps the machine for
// the rest of their slot and can start washing again (see startTurn's Branch
// 1), so this returns to PENDING rather than a terminal status. The only
// exception is finishing exactly at-or-after the slot's own end time, where
// there's no "rest of the slot" left to return to — that goes straight to
// COMPLETED rather than briefly becoming a PENDING turn that the very next
// read would just finalize anyway.
async function finishTurn(turnId, userId) {
  const existing = await findTurnOrThrow(turnId);
  const now = new Date();
  const nextStatus = now >= existing.endAt ? 'COMPLETED' : 'PENDING';

  const updated = await Turn.findOneAndUpdate(
    { _id: turnId, status: 'IN_USE', actingUserId: userId },
    { $set: { status: nextStatus, actingUserId: null, finishedAt: now } },
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
  await realtimeService.emitTurnUpdated(updated);

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
  await realtimeService.emitTurnUpdated(updated);

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
  await realtimeService.emitTurnRequestUpdated(turn.householdId, turn._id, request._id);
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
  await realtimeService.emitTurnUpdated(updatedTurn);
  await realtimeService.emitTurnRequestUpdated(updatedTurn.householdId, updatedTurn._id, acceptedRequest._id);

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
  await realtimeService.emitTurnRequestUpdated(turn.householdId, turn._id, request._id);
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
  await realtimeService.emitTurnRequestUpdated(request.householdId, request.turnId, request._id);
  return request;
}

module.exports = {
  getOrCreateCurrentSlotTurn,
  getCurrentTurn,
  finalizeIfExpired,
  findTurnOrThrow,
  startTurn,
  releaseTurn,
  claimTurn,
  finishTurn,
  transferTurn,
  createTurnRequest,
  listTurnRequests,
  acceptTurnRequest,
  rejectTurnRequest,
  cancelTurnRequest,
  cancelPendingRequestsFromUser,
};
