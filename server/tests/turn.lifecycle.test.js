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

async function createHousehold(token, name = 'Lifecycle House') {
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

async function getTodayTurn(token, householdId) {
  const res = await request(app)
    .get(`/api/households/${householdId}/turns/today`)
    .set('Authorization', `Bearer ${token}`);
  return res.body.turn;
}

async function getMachine(token, householdId) {
  const res = await request(app)
    .get(`/api/households/${householdId}/machine`)
    .set('Authorization', `Bearer ${token}`);
  return res.body.machine;
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('normal turn flow', () => {
  test('PENDING -> START -> IN_USE -> FINISH -> COMPLETED, machine state matches at every step', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);
    expect(turn.status).toBe('PENDING');
    expect((await getMachine(owner.token, household._id)).status).toBe('AVAILABLE');

    const start = await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ estimatedDurationMinutes: 45 })
      .expect(200);
    expect(start.body.turn.status).toBe('IN_USE');
    expect(start.body.turn.type).toBe('NORMAL');
    expect(start.body.turn.actingUserId).toBe(owner.id);
    expect(start.body.turn.startedAt).not.toBeNull();
    expect((await getMachine(owner.token, household._id)).status).toBe('IN_USE');

    const finish = await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(finish.body.turn.status).toBe('COMPLETED');
    expect(finish.body.turn.finishedAt).not.toBeNull();
    // The machine no longer "freezes" on COMPLETED for the rest of the day —
    // finishing immediately frees it up for another turn the same day (see
    // the multi-turn-per-day model in turn.service.js), so the very next
    // lookup materializes a fresh PENDING turn and the machine reads AVAILABLE.
    expect((await getMachine(owner.token, household._id)).status).toBe('AVAILABLE');
  });

  test('rejects invalid estimated durations', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    for (const bad of [-10, 0, 999999, 1.5, 'forty-five']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post(`/api/turns/${turn._id}/start`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ estimatedDurationMinutes: bad })
        .expect(400);
    }

    // still PENDING — none of the bad attempts should have gone through
    expect((await getTodayTurn(owner.token, household._id)).status).toBe('PENDING');
  });

  test('starting, finishing, or releasing an already-completed turn is rejected', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);
    await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);
    await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);
  });

  test('a non-acting member cannot finish someone else\'s turn', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const bystander = await registerUser(`bystander-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(bystander.token, household.inviteCode);
    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${bystander.token}`)
      .expect(403);
  });
});

describe('release flow', () => {
  test('PENDING -> RELEASED, and the scheduled user cannot start after releasing', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    const release = await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(release.body.turn.status).toBe('RELEASED');
    expect(release.body.turn.releasedAt).not.toBeNull();
    expect((await getMachine(owner.token, household._id)).status).toBe('RELEASED');

    // RELEASED is a state conflict for /start regardless of who asks — a
    // released turn must be claimed before it can be started.
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);
  });

  test('the scheduled user cannot reclaim their own released turn via emergency claim', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const res = await request(app)
      .post(`/api/turns/${turn._id}/claim`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    expect(res.body.error).toMatch(/cannot reclaim/i);
  });
});

describe('emergency flow', () => {
  test('PENDING -> RELEASED -> CLAIMED -> IN_USE -> COMPLETED, and only the claimant can act on it', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const emergencyUser = await registerUser(`emergency-${Date.now()}@test.com`);
    const bystander = await registerUser(`bystander-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(emergencyUser.token, household.inviteCode);
    await joinHousehold(bystander.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);
    await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const claim = await request(app)
      .post(`/api/turns/${turn._id}/claim`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(claim.body.turn.status).toBe('CLAIMED');
    expect(claim.body.turn.type).toBe('EMERGENCY');
    expect(claim.body.turn.actingUserId).toBe(emergencyUser.id);

    // owner (original scheduled user) cannot start the claimed turn
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    // an uninvolved bystander cannot start it either
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${bystander.token}`)
      .expect(403);

    const start = await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(start.body.turn.status).toBe('IN_USE');
    expect((await getMachine(owner.token, household._id)).status).toBe('IN_USE');

    // scheduled user cannot finish an emergency turn they don't own
    await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);

    const finish = await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(finish.body.turn.status).toBe('COMPLETED');
    // See the equivalent comment in 'normal turn flow' above — finishing
    // frees the machine immediately rather than freezing it for the day.
    expect((await getMachine(owner.token, household._id)).status).toBe('AVAILABLE');
  });

  test('claiming a turn that was never released is rejected', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const other = await registerUser(`other-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(other.token, household.inviteCode);
    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/claim`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(409);
  });
});

describe('cross-household isolation', () => {
  test('a user from another household cannot act on this turn', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    const outsider = await registerUser(`outsider-${Date.now()}@test.com`);
    await createHousehold(outsider.token, 'Other House'); // outsider belongs to a different household

    await request(app)
      .post(`/api/turns/${turn._id}/release`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });
});

describe('day-rollover carryover', () => {
  test('a wash still IN_USE from a previous day stays visible instead of being hidden behind a fresh PENDING turn', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    // Simulate the calendar day rolling over while the wash is still running.
    await Turn.findByIdAndUpdate(turn._id, { date: '2000-01-01' });

    const carriedOverTurn = await getTodayTurn(owner.token, household._id);
    expect(carriedOverTurn._id).toBe(turn._id);
    expect(carriedOverTurn.status).toBe('IN_USE');
    expect((await getMachine(owner.token, household._id)).status).toBe('IN_USE');

    // Finishing it should still work through the normal endpoint.
    await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    // Now that nothing is active, a fresh turn for today should appear.
    const freshTurn = await getTodayTurn(owner.token, household._id);
    expect(freshTurn._id).not.toBe(turn._id);
    expect(freshTurn.status).toBe('PENDING');
  });
});
