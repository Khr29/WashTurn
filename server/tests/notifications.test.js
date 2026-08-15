jest.mock('../src/config/firebase', () => ({
  getMessaging: jest.fn(),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const DeviceToken = require('../src/models/DeviceToken');
const { getMessaging } = require('../src/config/firebase');
const notificationService = require('../src/services/notification.service');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(authToken, name = 'Notif House') {
  const res = await request(app)
    .post('/api/households')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ name, timezone: 'UTC' });
  return res.body.household;
}

async function joinHousehold(authToken, inviteCode) {
  await request(app)
    .post('/api/households/join')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ inviteCode });
}

async function registerDeviceToken(authToken, fcmToken) {
  await request(app)
    .post('/api/notifications/register-token')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ token: fcmToken, platform: 'android' })
    .expect(204);
}

async function getTodayTurn(authToken, householdId) {
  const res = await request(app)
    .get(`/api/households/${householdId}/turns/today`)
    .set('Authorization', `Bearer ${authToken}`);
  return res.body.turn;
}

let mockSend;

beforeEach(() => {
  mockSend = jest.fn().mockImplementation(({ tokens }) =>
    Promise.resolve({ responses: tokens.map(() => ({ success: true })) })
  );
  getMessaging.mockReturnValue({ sendEachForMulticast: mockSend });
});

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('device token registration', () => {
  test('an authenticated user can register a token', async () => {
    const user = await registerUser(`tok-${Date.now()}@test.com`);
    await registerDeviceToken(user.token, `fcm-token-${Date.now()}`);
    const count = await DeviceToken.countDocuments({ userId: user.id });
    expect(count).toBe(1);
  });

  test('registering the same token twice does not create a duplicate', async () => {
    const user = await registerUser(`tok-${Date.now()}@test.com`);
    const fcmToken = `fcm-token-dup-${Date.now()}`;
    await registerDeviceToken(user.token, fcmToken);
    await registerDeviceToken(user.token, fcmToken);
    const count = await DeviceToken.countDocuments({ token: fcmToken });
    expect(count).toBe(1);
  });

  test('a user can register multiple device tokens (multi-device support)', async () => {
    const user = await registerUser(`tok-${Date.now()}@test.com`);
    await registerDeviceToken(user.token, `phone-${Date.now()}`);
    await registerDeviceToken(user.token, `tablet-${Date.now()}`);
    const count = await DeviceToken.countDocuments({ userId: user.id });
    expect(count).toBe(2);
  });

  test('registering a token without authentication is rejected', async () => {
    await request(app)
      .post('/api/notifications/register-token')
      .send({ token: 'no-auth-token', platform: 'android' })
      .expect(401);
  });

  test('a user can only unregister their own token', async () => {
    const owner = await registerUser(`tok-${Date.now()}@test.com`);
    const other = await registerUser(`tok-other-${Date.now()}@test.com`);
    const fcmToken = `fcm-token-own-${Date.now()}`;
    await registerDeviceToken(owner.token, fcmToken);

    await request(app)
      .delete('/api/notifications/register-token')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ token: fcmToken })
      .expect(204); // succeeds as a request, but should not have deleted anything

    expect(await DeviceToken.countDocuments({ token: fcmToken })).toBe(1);

    await request(app)
      .delete('/api/notifications/register-token')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ token: fcmToken })
      .expect(204);

    expect(await DeviceToken.countDocuments({ token: fcmToken })).toBe(0);
  });
});

describe('notification preferences', () => {
  test('default preferences are all enabled', async () => {
    const user = await registerUser(`pref-${Date.now()}@test.com`);
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.preferences).toMatchObject({
      turnToday: true,
      turnTomorrow: true,
      machineStarted: true,
      machineFinished: true,
      emergencyActivity: true,
    });
  });

  test('a user can disable a category and it is respected on send', async () => {
    const owner = await registerUser(`pref-owner-${Date.now()}@test.com`);
    const member = await registerUser(`pref-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);
    await registerDeviceToken(member.token, `fcm-pref-${Date.now()}`);

    await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ machineStarted: false })
      .expect(200);

    const turn = await getTodayTurn(owner.token, household._id);
    mockSend.mockClear();
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    // member disabled machineStarted, so no FCM call should include their token
    // (and no other household member has a token registered) — mockSend should
    // not have been invoked with any tokens at all.
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('notification recipient logic', () => {
  test('the actor is excluded and only other household members with tokens receive it', async () => {
    const owner = await registerUser(`recip-owner-${Date.now()}@test.com`);
    const member = await registerUser(`recip-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);

    const ownerFcmToken = `fcm-owner-${Date.now()}`;
    const memberFcmToken = `fcm-member-${Date.now()}`;
    await registerDeviceToken(owner.token, ownerFcmToken);
    await registerDeviceToken(member.token, memberFcmToken);

    const turn = await getTodayTurn(owner.token, household._id);
    mockSend.mockClear();
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentTokens = mockSend.mock.calls[0][0].tokens;
    expect(sentTokens).toContain(memberFcmToken);
    expect(sentTokens).not.toContain(ownerFcmToken);
  });

  test('users from another household never receive this household\'s notifications', async () => {
    const owner = await registerUser(`iso-owner-${Date.now()}@test.com`);
    const outsider = await registerUser(`iso-outsider-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token, 'Iso House A');
    await createHousehold(outsider.token, 'Iso House B');

    const outsiderFcmToken = `fcm-outsider-${Date.now()}`;
    await registerDeviceToken(outsider.token, outsiderFcmToken);

    const turn = await getTodayTurn(owner.token, household._id);
    mockSend.mockClear();
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    // owner has no token registered and is the only other "member" of household A,
    // so no eligible recipient exists — the outsider's token must never appear.
    if (mockSend.mock.calls.length > 0) {
      const sentTokens = mockSend.mock.calls[0][0].tokens;
      expect(sentTokens).not.toContain(outsiderFcmToken);
    }
  });
});

describe('turn events trigger notifications', () => {
  test('start, release, claim, and finish each call their notification function', async () => {
    const owner = await registerUser(`evt-owner-${Date.now()}@test.com`);
    const emergencyUser = await registerUser(`evt-emergency-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(emergencyUser.token, household.inviteCode);

    const startedSpy = jest.spyOn(notificationService, 'notifyTurnStarted');
    const releasedSpy = jest.spyOn(notificationService, 'notifyTurnReleased');
    const claimedSpy = jest.spyOn(notificationService, 'notifyEmergencyClaimed');
    const finishedSpy = jest.spyOn(notificationService, 'notifyTurnFinished');

    const turn = await getTodayTurn(owner.token, household._id);
    await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(releasedSpy).toHaveBeenCalledTimes(1);

    await request(app)
      .post(`/api/turns/${turn._id}/claim`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(claimedSpy).toHaveBeenCalledTimes(1);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(startedSpy).toHaveBeenCalledTimes(1);

    await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(finishedSpy).toHaveBeenCalledTimes(1);

    startedSpy.mockRestore();
    releasedSpy.mockRestore();
    claimedSpy.mockRestore();
    finishedSpy.mockRestore();
  });
});

describe('notification failure isolation', () => {
  test('an FCM failure never fails the underlying turn operation', async () => {
    const owner = await registerUser(`fail-owner-${Date.now()}@test.com`);
    const member = await registerUser(`fail-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);
    await registerDeviceToken(member.token, `fcm-fail-${Date.now()}`);

    mockSend.mockRejectedValueOnce(new Error('simulated FCM outage'));

    const turn = await getTodayTurn(owner.token, household._id);
    const res = await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(res.body.turn.status).toBe('IN_USE');

    const check = await request(app)
      .get(`/api/households/${household._id}/turns/today`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(check.body.turn.status).toBe('IN_USE');
  });

  test('a dead FCM token is removed instead of retried forever', async () => {
    const owner = await registerUser(`dead-owner-${Date.now()}@test.com`);
    const member = await registerUser(`dead-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);
    const deadToken = `fcm-dead-${Date.now()}`;
    await registerDeviceToken(member.token, deadToken);

    mockSend.mockImplementationOnce(({ tokens }) =>
      Promise.resolve({
        responses: tokens.map(() => ({
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        })),
      })
    );

    const turn = await getTodayTurn(owner.token, household._id);
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(await DeviceToken.countDocuments({ token: deadToken })).toBe(0);
  });
});

describe('turn reminders', () => {
  test('notifyTurnReminder only sends to the scheduled user, not the whole household', async () => {
    const owner = await registerUser(`rem-owner-${Date.now()}@test.com`);
    const member = await registerUser(`rem-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);

    const ownerFcmToken = `fcm-rem-owner-${Date.now()}`;
    const memberFcmToken = `fcm-rem-member-${Date.now()}`;
    await registerDeviceToken(owner.token, ownerFcmToken);
    await registerDeviceToken(member.token, memberFcmToken);

    const turn = await getTodayTurn(owner.token, household._id); // scheduledUserId = owner
    mockSend.mockClear();
    await notificationService.notifyTurnReminder(turn, 'today');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentTokens = mockSend.mock.calls[0][0].tokens;
    expect(sentTokens).toEqual([ownerFcmToken]);
  });
});
