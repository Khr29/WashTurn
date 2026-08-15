const DeviceToken = require('../models/DeviceToken');
const User = require('../models/User');
const { getMessaging } = require('../config/firebase');

async function registerToken({ userId, token, platform }) {
  await DeviceToken.findOneAndUpdate(
    { token },
    { userId, token, platform },
    { upsert: true, new: true }
  );
}

async function unregisterToken(token) {
  await DeviceToken.deleteOne({ token });
}

async function sendToUsers(userIds, { title, body }) {
  const messaging = getMessaging();
  if (!messaging) return; // notifications disabled (no Firebase credentials configured)

  const tokens = await DeviceToken.find({ userId: { $in: userIds } }).select('token');
  if (tokens.length === 0) return;

  try {
    await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title, body },
    });
  } catch (err) {
    console.error('FCM send failed:', err.message);
  }
}

async function usernameFor(userId) {
  const user = await User.findById(userId).select('name');
  return user?.name || 'Someone';
}

// Notifies everyone in the household except `excludeUserId`.
async function notifyHousehold(householdId, excludeUserId, payload) {
  const Household = require('../models/Household');
  const household = await Household.findById(householdId).select('members');
  const recipients = household.members
    .map((m) => m.userId.toString())
    .filter((id) => id !== excludeUserId.toString());
  await sendToUsers(recipients, payload);
}

async function notifyTurnStarted(turn) {
  const name = await usernameFor(turn.actingUserId);
  await notifyHousehold(turn.householdId, turn.actingUserId, {
    title: 'Machine in use',
    body: `${name} started ${turn.type === 'EMERGENCY' ? 'an emergency ' : 'a '}wash.`,
  });
}

async function notifyTurnReleased(turn) {
  const name = await usernameFor(turn.scheduledUserId);
  await notifyHousehold(turn.householdId, turn.scheduledUserId, {
    title: 'Turn released',
    body: `${name} released today's turn. The machine is free for emergency use.`,
  });
}

async function notifyEmergencyClaimed(turn) {
  const name = await usernameFor(turn.actingUserId);
  await notifyHousehold(turn.householdId, turn.actingUserId, {
    title: 'Emergency turn claimed',
    body: `${name} claimed today's released turn.`,
  });
}

async function notifyTurnFinished(turn) {
  const name = await usernameFor(turn.actingUserId);
  await notifyHousehold(turn.householdId, turn.actingUserId, {
    title: 'Machine free',
    body: `${name} finished washing. The machine is available.`,
  });
}

async function notifyTurnReminder(turn, when) {
  await sendToUsers([turn.scheduledUserId], {
    title: when === 'today' ? 'Your turn is today' : 'Your turn is tomorrow',
    body:
      when === 'today'
        ? "It's your day for the washing machine."
        : 'The washing machine is scheduled to be yours tomorrow.',
  });
}

module.exports = {
  registerToken,
  unregisterToken,
  notifyTurnStarted,
  notifyTurnReleased,
  notifyEmergencyClaimed,
  notifyTurnFinished,
  notifyTurnReminder,
};
