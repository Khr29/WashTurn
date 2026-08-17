const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const DryingRequest = require('../src/models/DryingRequest');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(token, name = 'Drying House') {
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

function createDryingRequest(token, { householdId, helperId, turnId }) {
  return request(app)
    .post('/api/drying-requests')
    .set('Authorization', `Bearer ${token}`)
    .send({ householdId, helperId, turnId });
}

function acceptDryingRequest(token, id) {
  return request(app).post(`/api/drying-requests/${id}/accept`).set('Authorization', `Bearer ${token}`);
}

function rejectDryingRequest(token, id) {
  return request(app).post(`/api/drying-requests/${id}/reject`).set('Authorization', `Bearer ${token}`);
}

function cancelDryingRequest(token, id) {
  return request(app).post(`/api/drying-requests/${id}/cancel`).set('Authorization', `Bearer ${token}`);
}

function completeDryingRequest(token, id) {
  return request(app).post(`/api/drying-requests/${id}/complete`).set('Authorization', `Bearer ${token}`);
}

function getBalances(token, householdId) {
  return request(app)
    .get(`/api/drying-requests/balances?householdId=${householdId}`)
    .set('Authorization', `Bearer ${token}`);
}

async function balanceBetween(token, householdId, otherUserId) {
  const res = await getBalances(token, householdId).expect(200);
  return res.body.balances.find((b) => b.userId === otherUserId) || { youOwe: 0, owesYou: 0 };
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
  await DryingRequest.syncIndexes();
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('A-D: request, accept, complete, favor is recorded', () => {
  test('Ahmed requests Khaled, Khaled accepts and completes; Ahmed now owes Khaled 1', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    const createRes = await createDryingRequest(ahmed.token, { householdId: household._id, helperId: khaled.id });
    expect(createRes.status).toBe(201);
    expect(createRes.body.request.status).toBe('PENDING');
    expect(createRes.body.request.requesterId).toBe(ahmed.id);
    expect(createRes.body.request.helperId).toBe(khaled.id);
    const requestId = createRes.body.request._id;

    const acceptRes = await acceptDryingRequest(khaled.token, requestId);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.request.status).toBe('ACCEPTED');
    expect(acceptRes.body.request.acceptedAt).toBeTruthy();

    const completeRes = await completeDryingRequest(khaled.token, requestId);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.request.status).toBe('COMPLETED');
    expect(completeRes.body.request.completedAt).toBeTruthy();

    const ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(1);
    expect(ahmedBalance.owesYou).toBe(0);

    const khaledBalance = await balanceBetween(khaled.token, household._id, ahmed.id);
    expect(khaledBalance.owesYou).toBe(1);
    expect(khaledBalance.youOwe).toBe(0);
  });
});

describe('E/F/T: reciprocal favors net the balance back to zero', () => {
  test('Ahmed later dries Khaled\'s clothes and the balance returns to 0', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    const req1 = await createDryingRequest(ahmed.token, { householdId: household._id, helperId: khaled.id }).expect(
      201
    );
    await acceptDryingRequest(khaled.token, req1.body.request._id).expect(200);
    await completeDryingRequest(khaled.token, req1.body.request._id).expect(200);

    let ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(1);

    // Reciprocal: Khaled requests Ahmed to dry Khaled's clothes.
    const req2 = await createDryingRequest(khaled.token, { householdId: household._id, helperId: ahmed.id }).expect(
      201
    );
    await acceptDryingRequest(ahmed.token, req2.body.request._id).expect(200);
    await completeDryingRequest(ahmed.token, req2.body.request._id).expect(200);

    ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(0);
    expect(ahmedBalance.owesYou).toBe(0);

    const khaledBalance = await balanceBetween(khaled.token, household._id, ahmed.id);
    expect(khaledBalance.youOwe).toBe(0);
    expect(khaledBalance.owesYou).toBe(0);
  });
});

describe('G/H: rejection creates no favor', () => {
  test('Khaled rejects a request; no favor is created', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
    }).expect(201);

    const rejectRes = await rejectDryingRequest(khaled.token, createRes.body.request._id);
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.request.status).toBe('REJECTED');
    expect(rejectRes.body.request.rejectedAt).toBeTruthy();

    const ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(0);
    expect(ahmedBalance.owesYou).toBe(0);
  });
});

describe('I/J: cancellation creates no favor', () => {
  test('Ahmed cancels a pending request; no favor is created', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
    }).expect(201);

    const cancelRes = await cancelDryingRequest(ahmed.token, createRes.body.request._id);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.request.status).toBe('CANCELLED');
    expect(cancelRes.body.request.cancelledAt).toBeTruthy();

    const ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(0);
    expect(ahmedBalance.owesYou).toBe(0);
  });

  test('only the requester can cancel; the helper cannot', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;
    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
    }).expect(201);

    await cancelDryingRequest(khaled.token, createRes.body.request._id).expect(403);
  });
});

describe('K: self-request is rejected', () => {
  test('a user cannot request themselves', async () => {
    const { users, household } = await setupHousehold(['solo']);
    const [solo] = users;
    const res = await createDryingRequest(solo.token, { householdId: household._id, helperId: solo.id });
    expect(res.status).toBe(400);
  });
});

describe('L: outside-household user cannot be requested', () => {
  test('a non-member cannot be selected as helper', async () => {
    const { users, household } = await setupHousehold(['ahmed']);
    const [ahmed] = users;
    const outsider = await registerUser(`outsider-${Date.now()}@test.com`);

    const res = await createDryingRequest(ahmed.token, { householdId: household._id, helperId: outsider.id });
    expect(res.status).toBe(400);
  });
});

describe('M: unauthorized accept is rejected', () => {
  test('a bystander cannot accept someone else\'s incoming request', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled', 'fadl']);
    const [ahmed, khaled, fadl] = users;

    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
    }).expect(201);

    await acceptDryingRequest(fadl.token, createRes.body.request._id).expect(403);
  });
});

describe('N: duplicate active request is rejected', () => {
  test('a second pending request for the same pair/task is rejected', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    await createDryingRequest(ahmed.token, { householdId: household._id, helperId: khaled.id }).expect(201);
    const second = await createDryingRequest(ahmed.token, { householdId: household._id, helperId: khaled.id });
    expect(second.status).toBe(409);
  });
});

describe('O: completing a task twice cannot create two favors', () => {
  test('a second completion attempt is rejected and the balance stays at 1', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
    }).expect(201);
    await acceptDryingRequest(khaled.token, createRes.body.request._id).expect(200);
    await completeDryingRequest(khaled.token, createRes.body.request._id).expect(200);

    const secondComplete = await completeDryingRequest(khaled.token, createRes.body.request._id);
    expect(secondComplete.status).toBe(409);

    const ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(1);
  });

  test('two concurrent completion attempts: only one succeeds', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;

    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
    }).expect(201);
    await acceptDryingRequest(khaled.token, createRes.body.request._id).expect(200);

    const [resA, resB] = await Promise.all([
      completeDryingRequest(khaled.token, createRes.body.request._id),
      completeDryingRequest(khaled.token, createRes.body.request._id),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const ahmedBalance = await balanceBetween(ahmed.token, household._id, khaled.id);
    expect(ahmedBalance.youOwe).toBe(1);
  });
});

describe('P: multiple unrelated drying requests can coexist', () => {
  test('different pairs and different turns do not conflict', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled', 'fadl']);
    const [ahmed, khaled, fadl] = users;

    const turnA = await getCurrentTurn(ahmed.token, household._id);
    await start(ahmed.token, turnA._id).expect(200);
    await finish(ahmed.token, turnA._id).expect(200);
    const turnB = await getCurrentTurn(ahmed.token, household._id);

    const r1 = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
      turnId: turnA._id,
    });
    const r2 = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: fadl.id,
      turnId: turnB._id,
    });
    const r3 = await createDryingRequest(khaled.token, { householdId: household._id, helperId: fadl.id });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(201);
  });
});

describe('Q/R/S: drying is independent of machine/turn status', () => {
  test('a drying request can be created with no turn at all', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;
    const res = await createDryingRequest(ahmed.token, { householdId: household._id, helperId: khaled.id });
    expect(res.status).toBe(201);
    expect(res.body.request.turnId).toBeFalsy();
  });

  test('the machine can be IN_USE while a drying request exists', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;
    const turn = await getCurrentTurn(ahmed.token, household._id);
    await start(ahmed.token, turn._id).expect(200);

    const res = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
      turnId: turn._id,
    });
    expect(res.status).toBe(201);

    const machineRes = await request(app)
      .get(`/api/households/${household._id}/machine`)
      .set('Authorization', `Bearer ${ahmed.token}`)
      .expect(200);
    expect(machineRes.body.machine.status).toBe('IN_USE');
  });

  test('the machine can be AVAILABLE while a drying task remains pending', async () => {
    const { users, household } = await setupHousehold(['ahmed', 'khaled']);
    const [ahmed, khaled] = users;
    const turn = await getCurrentTurn(ahmed.token, household._id);
    await start(ahmed.token, turn._id).expect(200);
    await finish(ahmed.token, turn._id).expect(200);

    const createRes = await createDryingRequest(ahmed.token, {
      householdId: household._id,
      helperId: khaled.id,
      turnId: turn._id,
    }).expect(201);
    await acceptDryingRequest(khaled.token, createRes.body.request._id).expect(200);

    const machineRes = await request(app)
      .get(`/api/households/${household._id}/machine`)
      .set('Authorization', `Bearer ${ahmed.token}`)
      .expect(200);
    expect(machineRes.body.machine.status).toBe('AVAILABLE');

    const stillPending = await request(app)
      .get(`/api/drying-requests/${createRes.body.request._id}/accept`)
      .set('Authorization', `Bearer ${khaled.token}`);
    // GET isn't a defined route for this id — just confirm the task is still ACCEPTED via list.
    expect(stillPending.status).toBe(404);

    const listRes = await request(app)
      .get(`/api/drying-requests?householdId=${household._id}&scope=tasks`)
      .set('Authorization', `Bearer ${khaled.token}`)
      .expect(200);
    expect(listRes.body.requests.some((r) => r._id === createRes.body.request._id)).toBe(true);
  });
});
