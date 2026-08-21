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
  test('PENDING -> START -> IN_USE -> FINISH -> PENDING (slot still open), machine state matches at every step', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);
    expect(turn.status).toBe('PENDING');
    expect(turn.startAt).not.toBeNull();
    expect(turn.endAt).not.toBeNull();
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
    // Finishing a wash does NOT end the turn — the owner still holds the
    // slot (its endAt hasn't arrived yet) and can wash again, so this goes
    // back to PENDING rather than a terminal status. See
    // turn.timeslot.test.js for the full time-slot behavior suite.
    expect(finish.body.turn.status).toBe('PENDING');
    expect(finish.body.turn.actingUserId).toBeNull();
    expect(finish.body.turn.finishedAt).not.toBeNull();
    expect((await getMachine(owner.token, household._id)).status).toBe('AVAILABLE');

    // The same turnId is still current — finishing did not materialize a new
    // turn, because the owner's slot (whole-day default here) hasn't ended.
    const stillCurrent = await getTodayTurn(owner.token, household._id);
    expect(stillCurrent._id).toBe(turn._id);
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
    // Finishing mid-slot no longer terminates the turn (see the flow test
    // above), so to exercise "already terminal" rejections here, force the
    // slot's end time into the past before finishing — the same real-time
    // boundary a slot naturally crosses on its own, just fast-forwarded.
    await Turn.findByIdAndUpdate(turn._id, { endAt: new Date(Date.now() - 1000) });
    const finish = await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(finish.body.turn.status).toBe('COMPLETED');

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
  test('PENDING -> RELEASED -> CLAIMED -> IN_USE -> PENDING (slot transferred, still open), and only the claimant can act on it', async () => {
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
    // Claiming reassigns ownership of the rest of the slot to the claimant
    // — a slot now survives multiple washes, so someone has to own "the
    // rest of it" once the emergency user is done with their first one.
    expect(claim.body.turn.scheduledUserId).toBe(emergencyUser.id);

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
    // See the equivalent comment in 'normal turn flow' above — finishing
    // doesn't end the turn, it frees the machine within the same slot.
    expect(finish.body.turn.status).toBe('PENDING');
    expect((await getMachine(owner.token, household._id)).status).toBe('AVAILABLE');

    // The emergency claimant now owns the rest of the slot and can wash
    // again without re-claiming or re-releasing.
    const secondWash = await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${emergencyUser.token}`)
      .expect(200);
    expect(secondWash.body.turn.status).toBe('IN_USE');
    expect(secondWash.body.turn.type).toBe('EMERGENCY');
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

describe('slot boundary drives currency, not calendar date', () => {
  test('a turn whose informational `date` field has rolled over stays current as long as its real endAt has not passed', async () => {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    // `date` is purely informational now (see Turn.js) — mutate it alone,
    // simulating what used to be "the calendar day rolled over", and confirm
    // it has zero effect on which turn is current. Only endAt does.
    await Turn.findByIdAndUpdate(turn._id, { date: '2000-01-01' });

    const stillCurrent = await getTodayTurn(owner.token, household._id);
    expect(stillCurrent._id).toBe(turn._id);
    expect(stillCurrent.status).toBe('IN_USE');
    expect((await getMachine(owner.token, household._id)).status).toBe('IN_USE');

    // Finishing still works and keeps the same turn open (its real endAt is
    // still in the future — see turn.timeslot.test.js for exhaustive
    // coverage of the endAt-driven finalize transition).
    const finish = await request(app)
      .post(`/api/turns/${turn._id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(finish.body.turn.status).toBe('PENDING');
    expect(finish.body.turn._id).toBe(turn._id);

    // Now push the *real* boundary (endAt) into the past — that's what
    // actually finalizes it and materializes a fresh turn.
    await Turn.findByIdAndUpdate(turn._id, { endAt: new Date(Date.now() - 1000) });
    const freshTurn = await getTodayTurn(owner.token, household._id);
    expect(freshTurn._id).not.toBe(turn._id);
    expect(freshTurn.status).toBe('PENDING');
  });
});
