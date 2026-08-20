const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Turn = require('../src/models/Turn');

const JWT_SECRET = process.env.JWT_SECRET;

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

async function createHousehold(token, name = 'Security House') {
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

function requestTurn(token, turnId) {
  return request(app).post(`/api/turns/${turnId}/requests`).set('Authorization', `Bearer ${token}`);
}

function acceptRequest(token, turnId, requestId) {
  return request(app)
    .post(`/api/turns/${turnId}/requests/${requestId}/accept`)
    .set('Authorization', `Bearer ${token}`);
}

function removeMember(token, householdId, memberUserId) {
  return request(app)
    .patch(`/api/households/${householdId}/members/${memberUserId}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('K/L: JWT validity', () => {
  test('an expired JWT is rejected', async () => {
    const user = await registerUser(`expired-${Date.now()}@test.com`);
    const expiredToken = jwt.sign({}, JWT_SECRET, {
      subject: user.id,
      algorithm: 'HS256',
      expiresIn: -10, // already expired
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  test('a token signed with alg "none" (algorithm-confusion attempt) is rejected', async () => {
    const user = await registerUser(`none-alg-${Date.now()}@test.com`);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: user.id })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forgedToken}`)
      .expect(401);
  });

  test('a token signed with a different secret is rejected', async () => {
    const user = await registerUser(`wrong-secret-${Date.now()}@test.com`);
    const forgedToken = jwt.sign({}, 'not-the-real-secret', { subject: user.id, algorithm: 'HS256' });

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forgedToken}`)
      .expect(401);
  });
});

describe('M: invalid ObjectId handling across resource types', () => {
  test('an invalid turn id returns 400, not 500', async () => {
    const user = await registerUser(`bad-turn-id-${Date.now()}@test.com`);
    const res = await request(app)
      .post('/api/turns/not-an-object-id/start')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(400);
    expect(res.body.error).not.toMatch(/at path|stack|mongoose/i);
  });

  test('an invalid drying request id returns 400, not 500', async () => {
    const user = await registerUser(`bad-drying-id-${Date.now()}@test.com`);
    await request(app)
      .post('/api/drying-requests/not-an-object-id/accept')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(400);
  });
});

describe('B/C: cross-household isolation beyond the household document itself', () => {
  test("a user from another household cannot read this household's machine", async () => {
    const owner = await registerUser(`machine-owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);

    const outsider = await registerUser(`machine-outsider-${Date.now()}@test.com`);
    await createHousehold(outsider.token, 'Outsider House');

    await request(app)
      .get(`/api/households/${household._id}/machine`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });

  test("a user from another household cannot modify this household's schedule", async () => {
    const owner = await registerUser(`sched-owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);

    const outsider = await registerUser(`sched-outsider-${Date.now()}@test.com`);
    await createHousehold(outsider.token, 'Outsider House');

    const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, userId: outsider.id }));

    await request(app)
      .put(`/api/households/${household._id}/schedule`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ days })
      .expect(403);
  });

  test("a user from another household cannot view this household's activity log", async () => {
    const owner = await registerUser(`activity-owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);

    const outsider = await registerUser(`activity-outsider-${Date.now()}@test.com`);
    await createHousehold(outsider.token, 'Outsider House');

    await request(app)
      .get(`/api/households/${household._id}/activity`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });
});

describe('H: householdId cannot be smuggled through the request body', () => {
  test('a non-member cannot create a drying request by supplying householdId in the body', async () => {
    const owner = await registerUser(`dry-owner-${Date.now()}@test.com`);
    const helper = await registerUser(`dry-helper-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(helper.token, household.inviteCode);

    const outsider = await registerUser(`dry-outsider-${Date.now()}@test.com`);

    const res = await request(app)
      .post('/api/drying-requests')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ householdId: household._id, helperId: helper.id })
      .expect(403);
    expect(res.body.error).toMatch(/not a member/i);
  });
});

describe('I/J: actingUserId and scheduledUserId cannot be smuggled through the request body', () => {
  test('starting a turn ignores an injected actingUserId and uses the authenticated caller instead', async () => {
    const owner = await registerUser(`inject-owner-${Date.now()}@test.com`);
    const other = await registerUser(`inject-other-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(other.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);

    const res = await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        actingUserId: other.id,
        scheduledUserId: other.id,
        householdId: '000000000000000000000000',
        estimatedDurationMinutes: 30,
      })
      .expect(200);

    // The turn belongs to `owner` (the authenticated caller), not `other`,
    // regardless of what the request body claimed.
    expect(res.body.turn.actingUserId).toBe(owner.id);
    expect(res.body.turn.scheduledUserId).toBe(owner.id);
    expect(res.body.turn.householdId).toBe(household._id);
  });

  test('a rejected cross-household start attempt leaves the turn completely unchanged (N)', async () => {
    const owner = await registerUser(`unchanged-owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    const turn = await getTodayTurn(owner.token, household._id);

    const outsider = await registerUser(`unchanged-outsider-${Date.now()}@test.com`);
    await createHousehold(outsider.token, 'Outsider House');

    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ estimatedDurationMinutes: 30 })
      .expect(403);

    const stillPending = await Turn.findById(turn._id);
    expect(stillPending.status).toBe('PENDING');
    expect(stillPending.actingUserId).toBeNull();
    expect(stillPending.startedAt).toBeNull();
  });
});

describe('removed-member authorization: a stale request cannot regain access', () => {
  test('accepting a request from a since-removed member is rejected, and ownership is unchanged', async () => {
    const owner = await registerUser(`stale-owner-${Date.now()}@test.com`);
    const requester = await registerUser(`stale-requester-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(requester.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);
    const reqRes = await requestTurn(requester.token, turn._id).expect(201);

    await removeMember(owner.token, household._id, requester.id).expect(200);

    const acceptRes = await acceptRequest(owner.token, turn._id, reqRes.body.request._id);
    expect(acceptRes.status).toBe(409);

    const stillOwner = await getTodayTurn(owner.token, household._id);
    expect(stillOwner.scheduledUserId).toBe(owner.id);
  });

  test('removing a member cancels their pending turn requests', async () => {
    const owner = await registerUser(`cancel-owner-${Date.now()}@test.com`);
    const requester = await registerUser(`cancel-requester-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(requester.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);
    const reqRes = await requestTurn(requester.token, turn._id).expect(201);

    await removeMember(owner.token, household._id, requester.id).expect(200);

    const listRes = await request(app)
      .get(`/api/turns/${turn._id}/requests`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const cancelled = listRes.body.requests.find((r) => r._id === reqRes.body.request._id);
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('household member removal: ownership and state guards', () => {
  test('only the household owner can remove a member', async () => {
    const owner = await registerUser(`rm-owner-${Date.now()}@test.com`);
    const memberA = await registerUser(`rm-a-${Date.now()}@test.com`);
    const memberB = await registerUser(`rm-b-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(memberA.token, household.inviteCode);
    await joinHousehold(memberB.token, household.inviteCode);

    await removeMember(memberA.token, household._id, memberB.id).expect(403);
  });

  test('the household owner cannot be removed', async () => {
    const owner = await registerUser(`rm-self-owner-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);

    await removeMember(owner.token, household._id, owner.id).expect(400);
  });

  test('a member with an active machine turn cannot be removed', async () => {
    const owner = await registerUser(`rm-active-owner-${Date.now()}@test.com`);
    const member = await registerUser(`rm-active-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);

    const turn = await getTodayTurn(owner.token, household._id);
    await request(app)
      .post(`/api/turns/${turn._id}/transfer`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ toUserId: member.id })
      .expect(200);
    await request(app)
      .post(`/api/turns/${turn._id}/start`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ estimatedDurationMinutes: 30 })
      .expect(200);

    await removeMember(owner.token, household._id, member.id).expect(409);
  });

  test('a removed member loses access and no longer appears in the members list', async () => {
    const owner = await registerUser(`rm-gone-owner-${Date.now()}@test.com`);
    const member = await registerUser(`rm-gone-member-${Date.now()}@test.com`);
    const household = await createHousehold(owner.token);
    await joinHousehold(member.token, household.inviteCode);

    await removeMember(owner.token, household._id, member.id).expect(200);

    const membersRes = await request(app)
      .get(`/api/households/${household._id}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(membersRes.body.members.some((m) => m.id === member.id)).toBe(false);

    await request(app)
      .get(`/api/households/${household._id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403);
  });
});

describe('input validation: malformed body types are rejected cleanly, not with a 500', () => {
  test('registering with a non-string email returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: { $ne: null }, password: 'password123' })
      .expect(400);
    expect(res.body.error).not.toMatch(/typeerror|not a function/i);
  });

  test('logging in with a non-string password returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@test.com', password: { $gt: '' } })
      .expect(400);
    expect(res.body.error).not.toMatch(/typeerror|not a function/i);
  });

  test('joining a household with a non-string invite code returns 400', async () => {
    const user = await registerUser(`join-typeconfusion-${Date.now()}@test.com`);
    const res = await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ inviteCode: 12345 })
      .expect(400);
    expect(res.body.error).not.toMatch(/typeerror|not a function/i);
  });

  test('creating a household with a non-string name returns 400', async () => {
    const user = await registerUser(`create-typeconfusion-${Date.now()}@test.com`);
    await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: ['not', 'a', 'string'] })
      .expect(400);
  });
});

describe('production-only hardening (unit-level, does not require a running server)', () => {
  test('invite codes are drawn from a uniform 32-character alphabet with no bias toward Math.random defaults', () => {
    const { generateInviteCode } = require('../src/utils/inviteCode');
    const codes = new Set();
    for (let i = 0; i < 200; i += 1) {
      codes.add(generateInviteCode());
    }
    // Collisions across 200 draws from a ~1.07e9 keyspace should be
    // astronomically unlikely; this mostly guards against a regression back
    // to a broken/constant generator.
    expect(codes.size).toBeGreaterThan(195);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});
