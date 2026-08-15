const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(token) {
  const res = await request(app)
    .post('/api/households')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Test House', timezone: 'UTC' });
  return res.body.household;
}

async function joinHousehold(token, inviteCode) {
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

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('emergency turn claim', () => {
  test('only one of two concurrent claimants succeeds', async () => {
    const owner = await registerUser('owner-race@test.com');
    const claimantA = await registerUser('claimant-a@test.com');
    const claimantB = await registerUser('claimant-b@test.com');

    const household = await createHousehold(owner.token);
    await joinHousehold(claimantA.token, household.inviteCode);
    await joinHousehold(claimantB.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);
    expect(turn.status).toBe('PENDING');
    expect(turn.scheduledUserId).toBe(owner.id);

    await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/turns/${turn._id}/claim`).set('Authorization', `Bearer ${claimantA.token}`),
      request(app).post(`/api/turns/${turn._id}/claim`).set('Authorization', `Bearer ${claimantB.token}`),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = resA.status === 200 ? resA.body.turn : resB.body.turn;
    expect(winner.status).toBe('CLAIMED');
    expect(winner.type).toBe('EMERGENCY');
  });

  test('scheduled user can normally start and finish without releasing', async () => {
    const owner = await registerUser('owner-normal@test.com');
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    const startRes = await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ estimatedDurationMinutes: 30 })
      .expect(200);
    expect(startRes.body.turn.status).toBe('IN_USE');
    expect(startRes.body.turn.type).toBe('NORMAL');

    const finishRes = await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(finishRes.body.turn.status).toBe('COMPLETED');
  });

  test('non-scheduled user cannot start before it is released', async () => {
    const owner = await registerUser('owner-block@test.com');
    const outsider = await registerUser('outsider-block@test.com');
    const household = await createHousehold(owner.token);
    await joinHousehold(outsider.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });
});
