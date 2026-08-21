const Household = require('../models/Household');
const Machine = require('../models/Machine');
const Schedule = require('../models/Schedule');
const User = require('../models/User');
const { generateInviteCode } = require('../utils/inviteCode');
const { ApiError } = require('../utils/ApiError');
const { defaultHouseholdTimezone } = require('../config/env');
const realtimeService = require('./realtime.service');

const INVITE_CODE_MAX_ATTEMPTS = 5;

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt += 1) {
    const code = generateInviteCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await Household.exists({ inviteCode: code });
    if (!exists) return code;
  }
  throw new ApiError(500, 'Could not generate a unique invite code, please retry.');
}

async function createHousehold({ name, ownerId, timezone }) {
  const inviteCode = await createUniqueInviteCode();

  const household = await Household.create({
    name,
    inviteCode,
    ownerId,
    timezone: timezone || defaultHouseholdTimezone,
    members: [{ userId: ownerId, joinedAt: new Date() }],
  });

  // A household is unusable without a machine and a schedule, so provision both
  // at creation time rather than lazily — avoids "household exists but machine
  // missing" edge cases everywhere else in the codebase.
  await Machine.create({ householdId: household._id, status: 'AVAILABLE' });

  const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    userId: ownerId,
    startTime: null,
    endTime: null,
  }));
  await Schedule.create({ householdId: household._id, days });

  return household;
}

async function joinHousehold({ inviteCode, userId }) {
  const household = await Household.findOne({ inviteCode: inviteCode.toUpperCase() });
  if (!household) {
    throw new ApiError(404, 'Invalid invite code.');
  }
  if (household.isMember(userId)) {
    throw new ApiError(409, 'You are already a member of this household.');
  }

  household.members.push({ userId, joinedAt: new Date() });
  await household.save();
  await realtimeService.emitHouseholdUpdated(household._id);
  return household;
}

// WashTurn v1 still assumes one household per user, so this returns at most
// one — but it's what lets the app recover a returning user's household
// after their on-device cache is gone (logout, reinstall, new device)
// instead of dead-ending them at onboarding, where "Join" on their own
// invite code only 409s ("already a member") with no way back in.
async function findMyHousehold(userId) {
  return Household.findOne({ 'members.userId': userId });
}

async function getMembers(household) {
  const userIds = household.members.map((m) => m.userId);
  const users = await User.find({ _id: { $in: userIds } }).select('name email');
  const users_by_id = new Map(users.map((u) => [u._id.toString(), u]));

  return household.members.map((m) => {
    const user = users_by_id.get(m.userId.toString());
    return {
      id: m.userId.toString(),
      name: user?.name,
      email: user?.email,
      joinedAt: m.joinedAt,
      isOwner: m.userId.toString() === household.ownerId.toString(),
    };
  });
}

async function removeMember(household, memberUserId) {
  if (memberUserId === household.ownerId.toString()) {
    throw new ApiError(400, 'The household owner cannot be removed.');
  }

  const Turn = require('../models/Turn');
  const hasActiveTurn = await Turn.exists({
    householdId: household._id,
    actingUserId: memberUserId,
    status: { $in: ['CLAIMED', 'IN_USE'] },
  });
  if (hasActiveTurn) {
    throw new ApiError(409, 'This member has an active machine turn and cannot be removed right now.');
  }

  household.members = household.members.filter((m) => m.userId.toString() !== memberUserId);
  await household.save();

  // Otherwise a pending request from the removed member lingers indefinitely
  // — still shown to turn owners as an "incoming request" from someone who
  // can no longer legitimately be granted the turn (see acceptTurnRequest's
  // membership re-check).
  const turnService = require('./turn.service');
  await turnService.cancelPendingRequestsFromUser(household._id, memberUserId);

  await realtimeService.emitMemberRemoved(household._id, memberUserId);

  return household;
}

module.exports = { createHousehold, joinHousehold, findMyHousehold, getMembers, removeMember };
