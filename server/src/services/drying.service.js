const DryingRequest = require('../models/DryingRequest');
const Household = require('../models/Household');
const Turn = require('../models/Turn');
const { ApiError } = require('../utils/ApiError');
const notificationService = require('./notification.service');

async function findDryingRequestOrThrow(id) {
  const request = await DryingRequest.findById(id);
  if (!request) {
    throw new ApiError(404, 'Drying request not found.');
  }
  return request;
}

// Requesting is intentionally decoupled from Turn/Machine status (see
// DryingRequest's turnId comment) — it must be possible regardless of what
// the machine is doing, since the clothes may already be out of the machine.
async function createDryingRequest(householdId, requesterId, helperId, turnId = null) {
  if (helperId === requesterId) {
    throw new ApiError(400, 'You cannot request yourself to dry your clothes.');
  }

  const household = await Household.findById(householdId);
  if (!household) {
    throw new ApiError(404, 'Household not found.');
  }
  if (!household.isMember(helperId)) {
    throw new ApiError(400, 'That user is not a member of this household.');
  }

  if (turnId) {
    const turn = await Turn.findById(turnId);
    if (!turn || turn.householdId.toString() !== householdId.toString()) {
      throw new ApiError(400, 'Invalid turn for this household.');
    }
  }

  let request;
  try {
    request = await DryingRequest.create({ householdId, requesterId, helperId, turnId: turnId || null });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'There is already an active drying request for this task.');
    }
    throw err;
  }

  await notificationService.notifyDryingRequested(request);
  return request;
}

// scope: 'incoming' (pending requests where I'm the helper), 'tasks' (accepted
// requests where I'm the helper — my active drying tasks to do), 'outgoing'
// (requests I sent), or omitted for everything involving me in this household.
async function listDryingRequests(householdId, userId, scope) {
  const filter = { householdId };
  if (scope === 'incoming') {
    filter.helperId = userId;
    filter.status = 'PENDING';
  } else if (scope === 'tasks') {
    filter.helperId = userId;
    filter.status = 'ACCEPTED';
  } else if (scope === 'outgoing') {
    filter.requesterId = userId;
  } else {
    filter.$or = [{ requesterId: userId }, { helperId: userId }];
  }
  return DryingRequest.find(filter).sort({ createdAt: -1 });
}

// Deciding between 403 (wrong user) and 409 (wrong status) after a failed
// conditional update must not use a status snapshot taken before the update
// raced — under concurrency that snapshot can be stale by the time the
// update actually loses, misreporting a status conflict as an authorization
// failure (see completeDryingRequest's concurrent-completion test). Only the
// requester/helper id is safe to check from a pre-update snapshot, since it
// never changes for a given request; the status shown in the 409 always
// comes from a fresh read taken after the update failed.
async function acceptDryingRequest(requestId, helperId) {
  const updated = await DryingRequest.findOneAndUpdate(
    { _id: requestId, helperId, status: 'PENDING' },
    { $set: { status: 'ACCEPTED', acceptedAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    const current = await findDryingRequestOrThrow(requestId);
    if (current.helperId.toString() !== helperId) {
      throw new ApiError(403, 'Only the requested helper can accept this drying request.');
    }
    throw new ApiError(409, `Drying request cannot be accepted from status ${current.status}.`);
  }

  await notificationService.notifyDryingAccepted(updated);
  return updated;
}

async function rejectDryingRequest(requestId, helperId) {
  const updated = await DryingRequest.findOneAndUpdate(
    { _id: requestId, helperId, status: 'PENDING' },
    { $set: { status: 'REJECTED', rejectedAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    const current = await findDryingRequestOrThrow(requestId);
    if (current.helperId.toString() !== helperId) {
      throw new ApiError(403, 'Only the requested helper can reject this drying request.');
    }
    throw new ApiError(409, `Drying request cannot be rejected from status ${current.status}.`);
  }

  await notificationService.notifyDryingRejected(updated);
  return updated;
}

async function cancelDryingRequest(requestId, requesterId) {
  const updated = await DryingRequest.findOneAndUpdate(
    { _id: requestId, requesterId, status: 'PENDING' },
    { $set: { status: 'CANCELLED', cancelledAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    const current = await findDryingRequestOrThrow(requestId);
    if (current.requesterId.toString() !== requesterId) {
      throw new ApiError(403, 'Only the requester can cancel this drying request.');
    }
    throw new ApiError(409, `Drying request cannot be cancelled from status ${current.status}.`);
  }

  await notificationService.notifyDryingCancelled(updated);
  return updated;
}

// The only transition that produces a favor. Guarded the same way as the Turn
// system's single-document atomic transitions: the findOneAndUpdate matched on
// status:'ACCEPTED' is what makes this race-safe — only one concurrent
// completion attempt can observe the still-ACCEPTED document, so a task can
// never be completed twice. The favor ledger itself needs no separate write or
// transaction: balances are derived live from COMPLETED requests (see
// getFavorBalances below), so this one atomic status flip is the entire
// "completion" side effect, and it can never desync from the ledger.
async function completeDryingRequest(requestId, helperId) {
  const updated = await DryingRequest.findOneAndUpdate(
    { _id: requestId, helperId, status: 'ACCEPTED' },
    { $set: { status: 'COMPLETED', completedAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    const current = await findDryingRequestOrThrow(requestId);
    if (current.helperId.toString() !== helperId) {
      throw new ApiError(403, 'Only the assigned helper can mark this drying task completed.');
    }
    throw new ApiError(409, `Drying request cannot be completed from status ${current.status}.`);
  }

  await notificationService.notifyDryingCompleted(updated);
  return updated;
}

// Directional, pairwise favor balances between the caller and every other
// household member they've exchanged completed drying tasks with — never a
// single household-wide score. Derived entirely from COMPLETED requests rather
// than a separately maintained counter, so it can never drift out of sync with
// request history and needs no dedicated concurrency handling of its own. A
// reciprocal favor nets directly against the existing debt instead of opening
// a second balance in the other direction, so exactly one of youOwe/owesYou is
// ever positive for a given pair, and neither can go negative.
async function getFavorBalances(householdId, userId) {
  const requests = await DryingRequest.find({
    householdId,
    status: 'COMPLETED',
    $or: [{ requesterId: userId }, { helperId: userId }],
  }).select('requesterId helperId');

  const counts = new Map();
  for (const r of requests) {
    const requesterId = r.requesterId.toString();
    const helperId = r.helperId.toString();
    const otherId = requesterId === userId ? helperId : requesterId;
    const entry = counts.get(otherId) || { iOwe: 0, owedToMe: 0 };
    if (requesterId === userId) {
      entry.iOwe += 1;
    } else {
      entry.owedToMe += 1;
    }
    counts.set(otherId, entry);
  }

  return Array.from(counts.entries())
    .map(([otherUserId, { iOwe, owedToMe }]) => ({
      userId: otherUserId,
      youOwe: Math.max(0, iOwe - owedToMe),
      owesYou: Math.max(0, owedToMe - iOwe),
    }))
    .filter((b) => b.youOwe !== 0 || b.owesYou !== 0);
}

module.exports = {
  findDryingRequestOrThrow,
  createDryingRequest,
  listDryingRequests,
  acceptDryingRequest,
  rejectDryingRequest,
  cancelDryingRequest,
  completeDryingRequest,
  getFavorBalances,
};
