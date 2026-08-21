const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const Turn = require('../src/models/Turn');
const Household = require('../src/models/Household');
const Schedule = require('../src/models/Schedule');
const turnService = require('../src/services/turn.service');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(token, name = 'Time-Slot House') {
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

describe('multiple washes within one open slot', () => {
  test('the same owner can start/finish three separate washes without the turn ever ending', async () => {
    const { users, household } = await setupHousehold(['khaled']);
    const [khaled] = users;

    const turn = await getCurrentTurn(khaled.token, household._id);
    expect(turn.status).toBe('PENDING');
    const turnId = turn._id;
    const { startAt, endAt } = turn;

    for (let wash = 0; wash < 3; wash += 1) {
      // eslint-disable-next-line no-await-in-loop
      const startRes = await start(khaled.token, turnId).expect(200);
      expect(startRes.body.turn.status).toBe('IN_USE');
      expect(startRes.body.turn._id).toBe(turnId);

      // eslint-disable-next-line no-await-in-loop
      const finishRes = await finish(khaled.token, turnId).expect(200);
      expect(finishRes.body.turn.status).toBe('PENDING');
      expect(finishRes.body.turn._id).toBe(turnId);
      // The slot's own boundaries never move just because a wash happened.
      expect(finishRes.body.turn.startAt).toBe(startAt);
      expect(finishRes.body.turn.endAt).toBe(endAt);
    }

    const stillCurrent = await getCurrentTurn(khaled.token, household._id);
    expect(stillCurrent._id).toBe(turnId);
    expect(stillCurrent.status).toBe('PENDING');
  });
});

describe('the next turn does not activate when a wash finishes early', () => {
  test('finishing well before the slot ends keeps the same turn current, not a fresh one', async () => {
    const { users, household } = await setupHousehold(['owner']);
    const [owner] = users;

    const turn = await getCurrentTurn(owner.token, household._id);
    // Default (no custom schedule times) is a whole household-local day, so
    // endAt is hours away — nowhere near reached by finishing right away.
    expect(new Date(turn.endAt).getTime()).toBeGreaterThan(Date.now() + 60000);

    await start(owner.token, turn._id).expect(200);
    const finishRes = await finish(owner.token, turn._id).expect(200);
    expect(finishRes.body.turn.status).toBe('PENDING');

    const current = await getCurrentTurn(owner.token, household._id);
    expect(current._id).toBe(turn._id);
    expect(current.status).toBe('PENDING');
  });
});

describe('the next turn activates exactly when the current slot ends — not before, not automatically later', () => {
  test('reading just before endAt keeps the old turn; reading at/after endAt hands off to the next slot', async () => {
    const { users, household } = await setupHousehold(['owner']);
    const [owner] = users;

    const turn = await getCurrentTurn(owner.token, household._id);
    const turnId = turn._id;

    // Move the slot's end time to just under half a second from now, without
    // touching anything else — this is the same real boundary a slot
    // crosses on its own, just fast-forwarded so the test doesn't have to
    // wait out a whole day.
    const soon = new Date(Date.now() + 400);
    await Turn.findByIdAndUpdate(turnId, { endAt: soon });

    // Still before endAt: the same turn must still be current.
    const beforeEnd = await getCurrentTurn(owner.token, household._id);
    expect(beforeEnd._id).toBe(turnId);
    expect(beforeEnd.status).toBe('PENDING');

    // Wait until strictly after the manipulated endAt.
    await new Promise((resolve) => setTimeout(resolve, 550));

    const afterEnd = await getCurrentTurn(owner.token, household._id);
    expect(afterEnd._id).not.toBe(turnId);
    expect(afterEnd.status).toBe('PENDING');

    // The old turn was finalized as EXPIRED (it was never actually washed).
    const oldTurn = await Turn.findById(turnId);
    expect(oldTurn.status).toBe('EXPIRED');
  });
});

describe('a slot crossing midnight resolves and hands off correctly, driven entirely by real time', () => {
  test('spans two calendar dates, stays current through the carryover, and only hands off once its real endAt passes', async () => {
    const { users, household: createdHousehold } = await setupHousehold(['monday', 'tuesday']);
    const [mondayUser, tuesdayUser] = users;

    // Monday (dayOfWeek=1): mondayUser, 22:00 -> 02:00 (crosses into Tuesday).
    // Tuesday (dayOfWeek=2): tuesdayUser, whole day (no custom times).
    // Every other day is an unused placeholder owned by mondayUser.
    const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      userId: mondayUser.id,
      startTime: null,
      endTime: null,
    }));
    days[1] = { dayOfWeek: 1, userId: mondayUser.id, startTime: '22:00', endTime: '02:00' };
    days[2] = { dayOfWeek: 2, userId: tuesdayUser.id, startTime: null, endTime: null };
    await Schedule.findOneAndUpdate({ householdId: createdHousehold._id }, { days });

    const household = await Household.findById(createdHousehold._id);

    // 2024-01-08 is a Monday, 2024-01-09 a Tuesday (verified via getUTCDay).
    const mondayEvening = new Date('2024-01-08T23:30:00.000Z'); // within Monday's slot
    const tuesdayEarlyMorning = new Date('2024-01-09T01:00:00.000Z'); // still within it (carryover)
    const tuesdayMorning = new Date('2024-01-09T10:00:00.000Z'); // after Monday's slot has ended

    // First read: materializes Monday's slot, which spans two calendar dates.
    const first = await turnService.getCurrentTurn(household, mondayEvening);
    expect(first.scheduledUserId.toString()).toBe(mondayUser.id);
    expect(first.startAt.toISOString()).toBe('2024-01-08T22:00:00.000Z');
    expect(first.endAt.toISOString()).toBe('2024-01-09T02:00:00.000Z');
    expect(first.startAt.getUTCDate()).not.toBe(first.endAt.getUTCDate());

    // Still early Tuesday morning, but before 02:00 — the overnight slot is
    // still current; the next turn must NOT have activated yet.
    const second = await turnService.getCurrentTurn(household, tuesdayEarlyMorning);
    expect(second._id.toString()).toBe(first._id.toString());
    expect(second.status).toBe('PENDING');

    // Past 02:00 Tuesday: Monday's slot has genuinely ended, so it's
    // finalized and Tuesday's own scheduled slot (a different owner) takes
    // over — exactly at the boundary, not before.
    const third = await turnService.getCurrentTurn(household, tuesdayMorning);
    expect(third._id.toString()).not.toBe(first._id.toString());
    expect(third.scheduledUserId.toString()).toBe(tuesdayUser.id);
    expect(third.startAt.toISOString()).toBe('2024-01-09T00:00:00.000Z');
    expect(third.endAt.toISOString()).toBe('2024-01-10T00:00:00.000Z');

    const finalizedFirst = await Turn.findById(first._id);
    expect(finalizedFirst.status).toBe('EXPIRED'); // never actually washed
  });
});

describe('turn requests and ownership handoff are scoped to one specific time slot', () => {
  test('accepting a request preserves the slot\'s own startAt/endAt, and a finalized slot cannot receive new requests', async () => {
    const { users, household } = await setupHousehold(['owner', 'requester']);
    const [owner, requester] = users;

    const turn = await getCurrentTurn(owner.token, household._id);
    await start(owner.token, turn._id).expect(200);

    const reqRes = await request(app)
      .post(`/api/turns/${turn._id}/requests`)
      .set('Authorization', `Bearer ${requester.token}`)
      .expect(201);

    const acceptRes = await request(app)
      .post(`/api/turns/${turn._id}/requests/${reqRes.body.request._id}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    // Ownership moved to the requester, but the slot itself — the same
    // turnId, the same startAt/endAt — is untouched by the handoff.
    expect(acceptRes.body.turn._id).toBe(turn._id);
    expect(acceptRes.body.turn.scheduledUserId).toBe(requester.id);
    expect(acceptRes.body.turn.startAt).toBe(turn.startAt);
    expect(acceptRes.body.turn.endAt).toBe(turn.endAt);

    // Now end that slot for real, and confirm a fresh slot appears...
    await Turn.findByIdAndUpdate(turn._id, { endAt: new Date(Date.now() - 1000) });
    const nextTurn = await getCurrentTurn(requester.token, household._id);
    expect(nextTurn._id).not.toBe(turn._id);

    // ...and that the old, now-finalized slot can no longer receive a new
    // request — a request only ever applies to its own specific, still-open
    // slot, never to "whatever happens to be current now".
    const staleRequest = await request(app)
      .post(`/api/turns/${turn._id}/requests`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(staleRequest.status).toBe(409);
  });
});
