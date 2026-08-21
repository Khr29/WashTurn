const { getIo, householdRoom, userRoom, evictUserFromHousehold } = require('../realtime/io');

// An emit failure (e.g. io not yet initialized in a test that hits a service
// directly) must never turn an already-successful write into a failed API
// response — same rationale as notification.service.js's safe() wrapper, and
// deliberately duplicated rather than shared so the two stay independent.
function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`Realtime emit failed (${fn.name}):`, err.message);
    }
  };
}

function toHousehold(householdId, event, payload) {
  const io = getIo();
  if (!io) return;
  io.to(householdRoom(householdId.toString())).emit(event, payload);
}

function toUser(userId, event, payload) {
  const io = getIo();
  if (!io) return;
  io.to(userRoom(userId.toString())).emit(event, payload);
}

async function emitTurnUpdatedImpl(turn) {
  toHousehold(turn.householdId, 'turn:updated', {
    householdId: turn.householdId.toString(),
    turnId: turn._id.toString(),
  });
}

async function emitTurnRequestUpdatedImpl(householdId, turnId, requestId) {
  toHousehold(householdId, 'turn_request:updated', {
    householdId: householdId.toString(),
    turnId: turnId.toString(),
    requestId: requestId?.toString() ?? null,
  });
}

async function emitDryingRequestUpdatedImpl(dryingRequest) {
  toHousehold(dryingRequest.householdId, 'drying_request:updated', {
    householdId: dryingRequest.householdId.toString(),
    dryingRequestId: dryingRequest._id.toString(),
  });
}

async function emitHouseholdUpdatedImpl(householdId) {
  toHousehold(householdId, 'household:updated', { householdId: householdId.toString() });
}

// The removed member's socket(s) may still be sitting in the household room
// at the moment of removal (they never called household:leave themselves) —
// evict them first so no further household broadcasts reach them, then tell
// their own user room specifically so their app can drop the household from
// local state.
async function emitMemberRemovedImpl(householdId, removedUserId) {
  await evictUserFromHousehold(removedUserId.toString(), householdId.toString());
  toUser(removedUserId, 'household:removed', { householdId: householdId.toString() });
  toHousehold(householdId, 'household:updated', { householdId: householdId.toString() });
}

async function emitActivityCreatedImpl(householdId) {
  toHousehold(householdId, 'activity:created', { householdId: householdId.toString() });
}

module.exports = {
  emitTurnUpdated: safe(emitTurnUpdatedImpl),
  emitTurnRequestUpdated: safe(emitTurnRequestUpdatedImpl),
  emitDryingRequestUpdated: safe(emitDryingRequestUpdatedImpl),
  emitHouseholdUpdated: safe(emitHouseholdUpdatedImpl),
  emitMemberRemoved: safe(emitMemberRemovedImpl),
  emitActivityCreated: safe(emitActivityCreatedImpl),
};
