const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email, email, password: 'password123' });
  return { token: res.body.token, id: res.body.user.id };
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('household creation and membership', () => {
  test('creating a household makes the creator the owner and its only member', async () => {
    const owner = await registerUser('owner1@test.com');

    const res = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Casa Uno', timezone: 'UTC' })
      .expect(201);

    const household = res.body.household;
    expect(household.ownerId).toBe(owner.id);
    expect(household.members).toHaveLength(1);
    expect(household.members[0].userId).toBe(owner.id);
    expect(household.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  test('a schedule is auto-provisioned with all 7 days assigned to the owner', async () => {
    const owner = await registerUser('owner2@test.com');
    const create = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Casa Dos' });
    const householdId = create.body.household._id;

    const res = await request(app)
      .get(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(res.body.schedule.days).toHaveLength(7);
    expect(new Set(res.body.schedule.days.map((d) => d.dayOfWeek)).size).toBe(7);
    expect(res.body.schedule.days.every((d) => d.userId === owner.id)).toBe(true);
  });

  test('a user can join with a valid invite code, and cannot join twice', async () => {
    const owner = await registerUser('owner3@test.com');
    const joiner = await registerUser('joiner3@test.com');

    const create = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Casa Tres' });
    const inviteCode = create.body.household.inviteCode;

    const joinRes = await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteCode })
      .expect(200);
    expect(joinRes.body.household.members).toHaveLength(2);

    await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteCode })
      .expect(409);
  });

  test('joining with an invalid invite code returns 404', async () => {
    const user = await registerUser('lonely@test.com');
    await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ inviteCode: 'ZZZZZZ' })
      .expect(404);
  });

  test('GET /households/mine returns null for a user with no household', async () => {
    const user = await registerUser('nohousehold@test.com');
    const res = await request(app)
      .get('/api/households/mine')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.household).toBeNull();
  });

  test('GET /households/mine recovers an existing member\'s household after their local cache is lost', async () => {
    const owner = await registerUser('mine-owner@test.com');
    const member = await registerUser('mine-member@test.com');
    const create = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Casa Mine' });
    const householdId = create.body.household._id;
    const inviteCode = create.body.household.inviteCode;

    await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ inviteCode });

    // Simulates the app after a logout/login or reinstall wiped its local
    // household-id cache: it has no id to call GET /:id with, only the
    // account's token — /mine is what lets it recover instead of offering
    // onboarding to someone who already has a household.
    const ownerMine = await request(app)
      .get('/api/households/mine')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(ownerMine.body.household._id).toBe(householdId);

    const memberMine = await request(app)
      .get('/api/households/mine')
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(memberMine.body.household._id).toBe(householdId);
  });

  test('a non-member is rejected with 403 from household routes', async () => {
    const owner = await registerUser('owner4@test.com');
    const outsider = await registerUser('outsider4@test.com');

    const create = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Casa Cuatro' });
    const householdId = create.body.household._id;

    await request(app)
      .get(`/api/households/${householdId}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });

  test('a malformed household id returns 400, not a raw 500', async () => {
    const user = await registerUser('caster@test.com');
    const res = await request(app)
      .get('/api/households/not-a-valid-id')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(400);
    expect(res.body.error).not.toMatch(/at path/i);
  });

  test('members list includes names and correct owner flag', async () => {
    const owner = await registerUser('owner5@test.com');
    const member = await registerUser('member5@test.com');
    const create = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Casa Cinco' });
    const householdId = create.body.household._id;
    const inviteCode = create.body.household.inviteCode;

    await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ inviteCode });

    const res = await request(app)
      .get(`/api/households/${householdId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const byId = Object.fromEntries(res.body.members.map((m) => [m.id, m]));
    expect(byId[owner.id]).toMatchObject({ name: 'owner5@test.com', isOwner: true });
    expect(byId[member.id]).toMatchObject({ name: 'member5@test.com', isOwner: false });
  });
});

describe('weekly schedule rules', () => {
  async function setupHouseholdWithTwoMembers() {
    const owner = await registerUser(`owner-${Date.now()}@test.com`);
    const member = await registerUser(`member-${Date.now()}@test.com`);
    const create = await request(app)
      .post('/api/households')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Schedule House', timezone: 'UTC' });
    const householdId = create.body.household._id;
    const inviteCode = create.body.household.inviteCode;

    await request(app)
      .post('/api/households/join')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ inviteCode });

    return { owner, member, householdId };
  }

  function fullWeek(userId) {
    return Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, userId }));
  }

  test('only the owner can update the schedule', async () => {
    const { owner, member, householdId } = await setupHouseholdWithTwoMembers();

    await request(app)
      .put(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ days: fullWeek(owner.id) })
      .expect(403);
  });

  test('a member outside the household cannot be assigned to the schedule', async () => {
    const { owner, householdId } = await setupHouseholdWithTwoMembers();
    const stranger = await registerUser(`stranger-${Date.now()}@test.com`);

    const res = await request(app)
      .put(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ days: fullWeek(stranger.id) })
      .expect(400);
    expect(res.body.error).toMatch(/not a member/i);
  });

  test('a schedule must contain exactly 7 unique day entries', async () => {
    const { owner, householdId } = await setupHouseholdWithTwoMembers();

    await request(app)
      .put(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ days: fullWeek(owner.id).slice(0, 6) })
      .expect(400);

    const duplicateDay = [...fullWeek(owner.id).slice(0, 6), { dayOfWeek: 0, userId: owner.id }];
    await request(app)
      .put(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ days: duplicateDay })
      .expect(400);
  });

  test("the owner can reassign a day, and today's turn reflects the update", async () => {
    const { owner, member, householdId } = await setupHouseholdWithTwoMembers();

    const updateRes = await request(app)
      .put(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ days: fullWeek(member.id) })
      .expect(200);
    expect(updateRes.body.schedule.days.every((d) => d.userId === member.id)).toBe(true);

    const todayRes = await request(app)
      .get(`/api/households/${householdId}/turns/today`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(todayRes.body.turn.scheduledUserId).toBe(member.id);
  });

  test('a regular member can read the schedule', async () => {
    const { member, householdId } = await setupHouseholdWithTwoMembers();
    await request(app)
      .get(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
  });

  test('emergency usage never modifies the permanent schedule', async () => {
    const { owner, member, householdId } = await setupHouseholdWithTwoMembers();

    const before = await request(app)
      .get(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const turnRes = await request(app)
      .get(`/api/households/${householdId}/turns/today`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const turnId = turnRes.body.turn._id;

    await request(app)
      .post(`/api/turns/${turnId}/release`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    await request(app)
      .post(`/api/turns/${turnId}/claim`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    await request(app)
      .post(`/api/turns/${turnId}/start`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    await request(app)
      .post(`/api/turns/${turnId}/finish`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    const after = await request(app)
      .get(`/api/households/${householdId}/schedule`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(after.body.schedule.days).toEqual(before.body.schedule.days);
  });
});
