const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const Turn = require('../src/models/Turn');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(token, name = 'Requests House') {
  const res = await request(app)
    .post('/api/households')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, timezone: 'UTC' });
  return res.body.household;
}

async function joinHousehold(token, inviteCode) {
  await request(app)
    .post('/api/households/join')
    .set('Authorization', `Bearer ${token}`)
    .send({ inviteCode });
}

async function getCurrentTurn(token, householdId) {
  const res = await request(app)
    .get(`/api/households/${householdId}/turns/today`)
    .set('Authorization', `Bearer ${token}`);
  return res.body.turn;
}

function start(token, turnId, minutes = 30) {
  return request(app)
    .post(`/api/turns/${turnId}/start`)
    .set('Authorization', `Bearer ${token}`)
    .send({ estimatedDurationMinutes: minutes });
}

function finish(token, turnId) {
  return request(app).post(`/api/turns/${turnId}/finish`).set('Authorization', `Bearer ${token}`);
}

function requestTurn(token, turnId) {
  return request(app).post(`/api/turns/${turnId}/requests`).set('Authorization', `Bearer ${token}`);
}

function listRequests(token, turnId) {
  return request(app).get(`/api/turns/${turnId}/requests`).set('Authorization', `Bearer ${token}`);
}

function acceptRequest(token, turnId, requestId) {
  return request(app)
    .post(`/api/turns/${turnId}/requests/${requestId}/accept`)
    .set('Authorization', `Bearer ${token}`);
}

function rejectRequest(token, turnId, requestId) {
  return request(app)
    .post(`/api/turns/${turnId}/requests/${requestId}/reject`)
    .set('Authorization', `Bearer ${token}`);
}

function transfer(token, turnId, toUserId) {
  return request(app)
    .post(`/api/turns/${turnId}/transfer`)
    .set('Authorization', `Bearer ${token}`)
    .send({ toUserId });
}

async function setupHousehold(names) {
  const users = await Promise.all(names.map((n) => registerUser(`${n}-${Date.now()}-${Math.random()}@test.com`)));
  const household = await createHousehold(users[0].token);
  for (const user of users.slice(1)) {
    // eslint-disable-next-line no-await-in-loop
    await joinHousehold(user.token, household.inviteCode);
  }
  return { users, household };
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await Turn.syncIndexes();
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('A: multiple turns per day for the same user', () => {
  test('the same user can complete a second turn the same calendar day', async () => {
    const { users, household } = await setupHousehold(['khaled']);
    const [khaled] = users;

    const turn1 = await getCurrentTurn(khaled.token, household._id);
    expect(turn1.scheduledUserId).toBe(khaled.id);

    await start(khaled.token, turn1._id).expect(200);
    await finish(khaled.token, turn1._id).expect(200);

    const turn2 = await getCurrentTurn(khaled.token, household._id);
    expect(turn2._id).not.toBe(turn1._id);
    expect(turn2.date).toBe(turn1.date);
    expect(turn2.status).toBe('PENDING');
    expect(turn2.scheduledUserId).toBe(khaled.id);

    const startRes = await start(khaled.token, turn2._id);
    expect(startRes.status).toBe(200);
    expect(startRes.body.turn.status).toBe('IN_USE');
  });

  test('a second open turn cannot be created for the same day while one is still open', async () => {
    const { users, household } = await setupHousehold(['ahmed']);
    const [ahmed] = users;
    const turn1 = await getCurrentTurn(ahmed.token, household._id);
    // Calling getCurrentTurn again before turn1 resolves must return the same
    // open turn, never create a second one.
    const turn1Again = await getCurrentTurn(ahmed.token, household._id);
    expect(turn1Again._id).toBe(turn1._id);
  });
});

describe('B/C/D/E/F: request another user\'s turn, including while IN_USE', () => {
  test('request succeeds while machine is IN_USE, owner sees it, accepts it, ownership transfers', async () => {
    const { users, household } = await setupHousehold(['khaled', 'ahmed']);
    const [khaled, ahmed] = users;

    const turn = await getCurrentTurn(khaled.token, household._id);
    expect(turn.scheduledUserId).toBe(khaled.id);

    await start(khaled.token, turn._id).expect(200);
    const inUse = await getCurrentTurn(khaled.token, household._id);
    expect(inUse.status).toBe('IN_USE');

    // C: Ahmed requests Khaled's turn while it's IN_USE.
    const reqRes = await requestTurn(ahmed.token, turn._id);
    expect(reqRes.status).toBe(201);
    expect(reqRes.body.request.status).toBe('PENDING');
    expect(reqRes.body.request.requesterId).toBe(ahmed.id);

    // D: Khaled (the owner) sees the incoming request.
    const listRes = await listRequests(khaled.token, turn._id).expect(200);
    expect(listRes.body.requests).toHaveLength(1);
    expect(listRes.body.requests[0].requesterId).toBe(ahmed.id);
    expect(listRes.body.requests[0].status).toBe('PENDING');

    // E: Khaled accepts it.
    const acceptRes = await acceptRequest(khaled.token, turn._id, listRes.body.requests[0]._id);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.request.status).toBe('ACCEPTED');

    // F: ownership changed to Ahmed. The IN_USE turn's actingUserId (Khaled,
    // who is physically running it right now) is untouched by the ownership
    // change — start/finish semantics for the in-progress wash are preserved.
    expect(acceptRes.body.turn.scheduledUserId).toBe(ahmed.id);
    expect(acceptRes.body.turn.actingUserId).toBe(khaled.id);
    expect(acceptRes.body.turn.status).toBe('IN_USE');

    // K: existing finish behavior still works for the original acting user.
    const finishRes = await finish(khaled.token, turn._id);
    expect(finishRes.status).toBe(200);
    expect(finishRes.body.turn.status).toBe('COMPLETED');
  });

  test('requesting your own turn is rejected', async () => {
    const { users, household } = await setupHousehold(['solo']);
    const [solo] = users;
    const turn = await getCurrentTurn(solo.token, household._id);
    const res = await requestTurn(solo.token, turn._id);
    expect(res.status).toBe(400);
  });

  test('duplicate pending requests from the same user are rejected', async () => {
    const { users, household } = await setupHousehold(['owner', 'dup']);
    const [owner, dup] = users;
    const turn = await getCurrentTurn(owner.token, household._id);

    await requestTurn(dup.token, turn._id).expect(201);
    const second = await requestTurn(dup.token, turn._id);
    expect(second.status).toBe(409);
  });

  test('only the current owner can accept or reject a request', async () => {
    const { users, household } = await setupHousehold(['owner', 'requester', 'bystander']);
    const [owner, requester, bystander] = users;
    const turn = await getCurrentTurn(owner.token, household._id);

    const reqRes = await requestTurn(requester.token, turn._id).expect(201);

    await acceptRequest(bystander.token, turn._id, reqRes.body.request._id).expect(403);
    await rejectRequest(bystander.token, turn._id, reqRes.body.request._id).expect(403);
  });

  test('a rejected request leaves ownership unchanged', async () => {
    const { users, household } = await setupHousehold(['owner', 'requester']);
    const [owner, requester] = users;
    const turn = await getCurrentTurn(owner.token, household._id);

    const reqRes = await requestTurn(requester.token, turn._id).expect(201);
    const rejectRes = await rejectRequest(owner.token, turn._id, reqRes.body.request._id);
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.request.status).toBe('REJECTED');

    const current = await getCurrentTurn(owner.token, household._id);
    expect(current.scheduledUserId).toBe(owner.id);
  });
});

describe('G/H/I: multiple requests for the same turn resolve to exactly one owner', () => {
  test('accepting one request cancels the others, and the others cannot be separately accepted', async () => {
    const { users, household } = await setupHousehold(['khaled', 'ahmed', 'fadl', 'omar']);
    const [khaled, ahmed, fadl, omar] = users;
    const turn = await getCurrentTurn(khaled.token, household._id);

    const reqAhmed = await requestTurn(ahmed.token, turn._id).expect(201);
    const reqFadl = await requestTurn(fadl.token, turn._id).expect(201);
    const reqOmar = await requestTurn(omar.token, turn._id).expect(201);

    // H: owner accepts Fadl's request.
    const acceptRes = await acceptRequest(khaled.token, turn._id, reqFadl.body.request._id);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.turn.scheduledUserId).toBe(fadl.id);

    // I: the other pending requests were cancelled and cannot acquire the turn.
    const listRes = await listRequests(khaled.token, turn._id).expect(200);
    const byId = Object.fromEntries(listRes.body.requests.map((r) => [r._id, r.status]));
    expect(byId[reqAhmed.body.request._id]).toBe('CANCELLED');
    expect(byId[reqOmar.body.request._id]).toBe('CANCELLED');
    expect(byId[reqFadl.body.request._id]).toBe('ACCEPTED');

    // Fadl is now the owner, not Khaled — so Khaled is no longer even
    // authorized to accept requests on this turn (403), let alone Ahmed's
    // already-cancelled one.
    const secondAccept = await acceptRequest(khaled.token, turn._id, reqAhmed.body.request._id);
    expect(secondAccept.status).toBe(403);

    const current = await getCurrentTurn(khaled.token, household._id);
    expect(current.scheduledUserId).toBe(fadl.id);
  });

  test('two concurrent accepts for different requests on the same turn: only one can win', async () => {
    const { users, household } = await setupHousehold(['owner', 'reqA', 'reqB']);
    const [owner, reqA, reqB] = users;
    const turn = await getCurrentTurn(owner.token, household._id);

    const requestA = await requestTurn(reqA.token, turn._id).expect(201);
    const requestB = await requestTurn(reqB.token, turn._id).expect(201);

    const [resA, resB] = await Promise.all([
      acceptRequest(owner.token, turn._id, requestA.body.request._id),
      acceptRequest(owner.token, turn._id, requestB.body.request._id),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winnerBody = resA.status === 200 ? resA.body : resB.body;
    const winnerUserId = winnerBody.request.requesterId;
    expect([reqA.id, reqB.id]).toContain(winnerUserId);

    const current = await getCurrentTurn(owner.token, household._id);
    expect(current.scheduledUserId).toBe(winnerUserId);
  });
});

describe('J: direct transfer to a selected household member', () => {
  test('the owner can give their turn directly to another member', async () => {
    const { users, household } = await setupHousehold(['khaled', 'fadl']);
    const [khaled, fadl] = users;
    const turn = await getCurrentTurn(khaled.token, household._id);

    const res = await transfer(khaled.token, turn._id, fadl.id);
    expect(res.status).toBe(200);
    expect(res.body.turn.scheduledUserId).toBe(fadl.id);

    // Fadl (the new owner) can now start it; Khaled (former owner) cannot.
    await start(khaled.token, turn._id).expect(403);
    await start(fadl.token, turn._id).expect(200);
  });

  test('only the current owner can transfer, and cannot transfer to a non-member', async () => {
    const { users, household } = await setupHousehold(['khaled', 'ahmed']);
    const [khaled, ahmed] = users;
    const turn = await getCurrentTurn(khaled.token, household._id);

    await transfer(ahmed.token, turn._id, khaled.id).expect(403);

    const outsider = await registerUser(`outsider-${Date.now()}@test.com`);
    await transfer(khaled.token, turn._id, outsider.id).expect(400);
  });

  test('transfer cancels any pending requests on that turn', async () => {
    const { users, household } = await setupHousehold(['khaled', 'ahmed', 'fadl']);
    const [khaled, ahmed, fadl] = users;
    const turn = await getCurrentTurn(khaled.token, household._id);

    const reqRes = await requestTurn(ahmed.token, turn._id).expect(201);
    await transfer(khaled.token, turn._id, fadl.id).expect(200);

    const listRes = await listRequests(khaled.token, turn._id).expect(200);
    const ahmedRequest = listRes.body.requests.find((r) => r._id === reqRes.body.request._id);
    expect(ahmedRequest.status).toBe('CANCELLED');
  });

  test('a completed turn cannot be transferred', async () => {
    const { users, household } = await setupHousehold(['khaled', 'ahmed']);
    const [khaled, ahmed] = users;
    const turn = await getCurrentTurn(khaled.token, household._id);

    await start(khaled.token, turn._id).expect(200);
    await finish(khaled.token, turn._id).expect(200);

    await transfer(khaled.token, turn._id, ahmed.id).expect(409);
  });
});

describe('K: existing start/finish/release behavior is unaffected', () => {
  test('normal PENDING -> IN_USE -> COMPLETED flow still works exactly as before', async () => {
    const { users, household } = await setupHousehold(['solo']);
    const [solo] = users;
    const turn = await getCurrentTurn(solo.token, household._id);
    expect(turn.status).toBe('PENDING');

    await start(solo.token, turn._id).expect(200);
    const finishRes = await finish(solo.token, turn._id);
    expect(finishRes.status).toBe(200);
    expect(finishRes.body.turn.status).toBe('COMPLETED');
  });

  test('release still works and still blocks reclaiming by the releaser', async () => {
    const { users, household } = await setupHousehold(['solo']);
    const [solo] = users;
    const turn = await getCurrentTurn(solo.token, household._id);

    const releaseRes = await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${solo.token}`);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.turn.status).toBe('RELEASED');

    const claimRes = await request(app)
      .post(`/api/turns/${turn._id}/claim`)
      .set('Authorization', `Bearer ${solo.token}`);
    expect(claimRes.status).toBe(403);
  });
});
