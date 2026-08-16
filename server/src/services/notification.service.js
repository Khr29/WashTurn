const DeviceToken = require('../models/DeviceToken');
const User = require('../models/User');
const Household = require('../models/Household');
const { getMessaging } = require('../config/firebase');

// FCM error codes that mean "this token will never work again" — safe to
// delete rather than retry indefinitely.
const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

async function registerToken({ userId, token, platform }) {
  await DeviceToken.findOneAndUpdate(
    { token },
    { userId, token, platform },
    { upsert: true, new: true }
  );
}

// Scoped to the caller's own userId so one user can never remove another
// user's device token.
async function unregisterToken(userId, token) {
  await DeviceToken.deleteOne({ token, userId });
}

const DEFAULT_PREFERENCES = {
  turnToday: true,
  turnTomorrow: true,
  machineStarted: true,
  machineFinished: true,
  emergencyActivity: true,
  turnRequests: true,
};

// Falls back to all-enabled defaults for a user document that predates the
// notificationPreferences field — Mongoose only applies schema defaults at
// document construction, not when reading a pre-existing document that
// simply lacks the field, so this can't rely on the schema default alone.
async function getPreferences(userId) {
  const user = await User.findById(userId).select('notificationPreferences');
  return user?.notificationPreferences || DEFAULT_PREFERENCES;
}

async function updatePreferences(userId, updates) {
  const allowedKeys = [
    'turnToday',
    'turnTomorrow',
    'machineStarted',
    'machineFinished',
    'emergencyActivity',
    'turnRequests',
  ];
  const $set = {};
  for (const key of allowedKeys) {
    if (typeof updates[key] === 'boolean') {
      $set[`notificationPreferences.${key}`] = updates[key];
    }
  }
  const user = await User.findByIdAndUpdate(userId, { $set }, { new: true }).select('notificationPreferences');
  return user.notificationPreferences;
}

// Sends to whichever of `userIds` have `category` enabled (defaulting to
// enabled if a user predates the preferences field). Never throws — a
// notification is a side effect of an already-committed state change, and a
// delivery failure must never turn a successful machine operation into a
// failed API response.
async function sendToUsers(userIds, category, { title, body, data }) {
  try {
    const messaging = getMessaging();
    if (!messaging || userIds.length === 0) return;

    const recipients = await User.find({ _id: { $in: userIds } }).select('notificationPreferences');
    const eligibleIds = recipients
      .filter((u) => u.notificationPreferences?.[category] !== false)
      .map((u) => u._id.toString());
    if (eligibleIds.length === 0) return;

    const tokens = await DeviceToken.find({ userId: { $in: eligibleIds } }).select('token');
    if (tokens.length === 0) return;

    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title, body },
      data: data || {},
    });

    const deadTokens = response.responses
      .map((r, i) => (!r.success && DEAD_TOKEN_ERROR_CODES.has(r.error?.code) ? tokens[i].token : null))
      .filter(Boolean);
    if (deadTokens.length > 0) {
      await DeviceToken.deleteMany({ token: { $in: deadTokens } });
    }
  } catch (err) {
    console.error('Notification dispatch failed:', err.message);
  }
}

async function usernameFor(userId) {
  const user = await User.findById(userId).select('name');
  return user?.name || 'Someone';
}

// Notifies everyone in the household except `excludeUserId`.
async function notifyHousehold(householdId, excludeUserId, category, payload) {
  const household = await Household.findById(householdId).select('members');
  const recipients = household.members
    .map((m) => m.userId.toString())
    .filter((id) => id !== excludeUserId.toString());
  await sendToUsers(recipients, category, payload);
}

// A notification failure — anywhere in the pipeline, not just the FCM call —
// must never turn an already-successful machine operation into a failed API
// response. Every publicly exported notify* function is wrapped with this so
// callers in turn.service.js never need a try/catch of their own.
function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`Notification failed (${fn.name}):`, err.message);
    }
  };
}

async function notifyTurnStartedImpl(turn) {
  const name = await usernameFor(turn.actingUserId);
  await notifyHousehold(turn.householdId, turn.actingUserId, 'machineStarted', {
    title: '🧺 WashTurn',
    body: `${name} started using the washing machine.`,
    data: { type: 'TURN_STARTED', turnId: turn._id.toString() },
  });
}

async function notifyTurnReleasedImpl(turn) {
  const name = await usernameFor(turn.scheduledUserId);
  await notifyHousehold(turn.householdId, turn.scheduledUserId, 'emergencyActivity', {
    title: '🚨 WashTurn',
    body: `${name} released today's turn. The machine is available for emergency use.`,
    data: { type: 'TURN_RELEASED', turnId: turn._id.toString() },
  });
}

async function notifyEmergencyClaimedImpl(turn) {
  const name = await usernameFor(turn.actingUserId);
  await notifyHousehold(turn.householdId, turn.actingUserId, 'emergencyActivity', {
    title: '🚨 WashTurn',
    body: `${name} claimed the washing machine for an emergency.`,
    data: { type: 'EMERGENCY_CLAIMED', turnId: turn._id.toString() },
  });
}

async function notifyTurnFinishedImpl(turn) {
  const name = await usernameFor(turn.actingUserId);
  await notifyHousehold(turn.householdId, turn.actingUserId, 'machineFinished', {
    title: '✅ WashTurn',
    body: `${name} finished using the washing machine. It's available now.`,
    data: { type: 'TURN_FINISHED', turnId: turn._id.toString() },
  });
}

async function notifyTurnRequestedImpl(turn, requesterId) {
  const name = await usernameFor(requesterId);
  await sendToUsers([turn.scheduledUserId], 'turnRequests', {
    title: '🙋 WashTurn',
    body: `${name} requested your turn.`,
    data: { type: 'TURN_REQUESTED', turnId: turn._id.toString() },
  });
}

async function notifyRequestAcceptedImpl(turn, requesterId) {
  await sendToUsers([requesterId], 'turnRequests', {
    title: '🧺 WashTurn',
    body: 'Your turn request was accepted. The turn is yours now.',
    data: { type: 'TURN_REQUEST_ACCEPTED', turnId: turn._id.toString() },
  });
}

async function notifyRequestRejectedImpl(turn, requesterId) {
  const name = await usernameFor(turn.scheduledUserId);
  await sendToUsers([requesterId], 'turnRequests', {
    title: '🧺 WashTurn',
    body: `${name} declined your turn request.`,
    data: { type: 'TURN_REQUEST_REJECTED', turnId: turn._id.toString() },
  });
}

async function notifyTurnTransferredImpl(turn, fromUserId, toUserId) {
  const name = await usernameFor(fromUserId);
  await sendToUsers([toUserId], 'turnRequests', {
    title: '🧺 WashTurn',
    body: `${name} gave you their turn.`,
    data: { type: 'TURN_TRANSFERRED', turnId: turn._id.toString() },
  });
}

async function notifyTurnReminderImpl(turn, when) {
  const category = when === 'today' ? 'turnToday' : 'turnTomorrow';
  await sendToUsers([turn.scheduledUserId], category, {
    title: when === 'today' ? '🧺 WashTurn' : '⏰ WashTurn',
    body:
      when === 'today'
        ? "It's your washing-machine turn today."
        : 'Your washing-machine turn is tomorrow.',
    data: { type: when === 'today' ? 'TURN_TODAY' : 'TURN_TOMORROW' },
  });
}

module.exports = {
  registerToken,
  unregisterToken,
  getPreferences,
  updatePreferences,
  notifyTurnStarted: safe(notifyTurnStartedImpl),
  notifyTurnReleased: safe(notifyTurnReleasedImpl),
  notifyEmergencyClaimed: safe(notifyEmergencyClaimedImpl),
  notifyTurnFinished: safe(notifyTurnFinishedImpl),
  notifyTurnReminder: safe(notifyTurnReminderImpl),
  notifyTurnRequested: safe(notifyTurnRequestedImpl),
  notifyRequestAccepted: safe(notifyRequestAcceptedImpl),
  notifyRequestRejected: safe(notifyRequestRejectedImpl),
  notifyTurnTransferred: safe(notifyTurnTransferredImpl),
};
