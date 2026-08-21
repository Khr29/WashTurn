const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const app = require('../src/app');
const { initIo } = require('../src/realtime/io');

let httpServer;
let baseUrl;
const sockets = [];

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(token, name = 'Realtime House') {
  const res = await request(app)
    .post('/api/households')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, timezone: 'UTC' });
  return res.body.household;
}

async function joinHouseholdRest(token, inviteCode) {
  await request(app)
    .post('/api/households/join')
    .set('Authorization', `Bearer ${token}`)
    .send({ inviteCode });
}

async function getTodayTurn(token, householdId) {
  const res = await request(app)
    .get(`/api/households/${householdId}/turns/today`)
    .set('Authorization', `Bearer ${token}`);
  return res.body.turn;
}

function connectSocket(token) {
  const socket = ioClient(baseUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function joinHouseholdRoom(socket, householdId) {
  return new Promise((resolve) => {
    socket.emit('household:join', householdId, resolve);
  });
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  httpServer = http.createServer(app);
  initIo(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  baseUrl = `http://localhost:${port}`;
});

afterEach(() => {
  while (sockets.length) {
    const socket = sockets.pop();
    if (socket.connected) socket.disconnect();
  }
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('socket authentication', () => {
  test('rejects a connection with no token', async () => {
    const socket = connectSocket(undefined);
    const err = await waitForEvent(socket, 'connect_error');
    expect(err.message).toMatch(/token/i);
  });

  test('rejects a connection with an invalid token', async () => {
    const socket = connectSocket('not-a-real-token');
    const err = await waitForEvent(socket, 'connect_error');
    expect(err.message).toMatch(/invalid|expired/i);
  });

  test('accepts a connection with a valid token', async () => {
    const user = await registerUser(`sock-auth-${Date.now()}@test.com`);
    const socket = connectSocket(user.token);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
  });
});

describe('household room membership', () => {
  test('a member can join their household room; a non-member cannot', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const outsider = await registerUser(`outsider-${Date.now()}@test.com`);

    const ownerSocket = connectSocket(owner.token);
    await waitForConnect(ownerSocket);
    const ownerAck = await joinHouseholdRoom(ownerSocket, household._id);
    expect(ownerAck.ok).toBe(true);

    const outsiderSocket = connectSocket(outsider.token);
    await waitForConnect(outsiderSocket);
    const outsiderAck = await joinHouseholdRoom(outsiderSocket, household._id);
    expect(outsiderAck.ok).toBe(false);
  });
});

describe('cross-user real-time sync', () => {
  test('starting a turn notifies another connected household member, but not an outsider', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);

    const member = await registerUser(`member-${Date.now()}@test.com`);
    await joinHouseholdRest(member.token, household.inviteCode);

    const outsider = await registerUser(`outsider2-${Date.now()}@test.com`);
    const otherHousehold = await createHousehold(outsider.token, 'Other House');

    const ownerSocket = connectSocket(owner.token);
    const memberSocket = connectSocket(member.token);
    const outsiderSocket = connectSocket(outsider.token);

    await Promise.all([waitForConnect(ownerSocket), waitForConnect(memberSocket), waitForConnect(outsiderSocket)]);
    await Promise.all([
      joinHouseholdRoom(ownerSocket, household._id),
      joinHouseholdRoom(memberSocket, household._id),
      joinHouseholdRoom(outsiderSocket, otherHousehold._id),
    ]);

    const memberEvent = waitForEvent(memberSocket, 'turn:updated');
    const activityEvent = waitForEvent(memberSocket, 'activity:created');
    let outsiderGotEvent = false;
    outsiderSocket.once('turn:updated', () => {
      outsiderGotEvent = true;
    });

    const turn = await getTodayTurn(owner.token, household._id);
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ estimatedDurationMinutes: 30 })
      .expect(200);

    const payload = await memberEvent;
    expect(payload.turnId).toBe(turn._id);
    expect(payload.householdId).toBe(household._id);
    await activityEvent;

    // Give the outsider a moment they shouldn't need — if this ever flakes
    // true, it means household isolation broke.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(outsiderGotEvent).toBe(false);
  });

  test('a removed member is evicted from the household room and notified directly', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);

    const member = await registerUser(`member2-${Date.now()}@test.com`);
    await joinHouseholdRest(member.token, household.inviteCode);

    const memberSocket = connectSocket(member.token);
    await waitForConnect(memberSocket);
    const ack = await joinHouseholdRoom(memberSocket, household._id);
    expect(ack.ok).toBe(true);

    const removedEvent = waitForEvent(memberSocket, 'household:removed');

    await request(app)
      .patch(`/api/households/${household._id}/members/${member.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const payload = await removedEvent;
    expect(payload.householdId).toBe(household._id);
  });
});
