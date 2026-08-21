const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe('authentication', () => {
  test('register creates a user and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'alice@test.com', password: 'password123' })
      .expect(201);

    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Alice', email: 'alice@test.com' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('register rejects a duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob@test.com', password: 'password123' })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob Again', email: 'bob@test.com', password: 'password123' })
      .expect(409);

    expect(res.body.error).toMatch(/already exists/i);
  });

  test('register rejects a short password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Short', email: 'short@test.com', password: '123' })
      .expect(400);
  });

  test('login succeeds with correct credentials', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Carol', email: 'carol@test.com', password: 'password123' })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carol@test.com', password: 'password123' })
      .expect(200);

    expect(res.body.token).toEqual(expect.any(String));
  });

  test('login rejects a wrong password without revealing which field was wrong', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dave', email: 'dave@test.com', password: 'password123' })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dave@test.com', password: 'wrongpassword' })
      .expect(401);

    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  test('login rejects an unknown email', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' })
      .expect(401);
  });

  test('GET /auth/me returns the current user for a valid token', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Erin', email: 'erin@test.com', password: 'password123' })
      .expect(201);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(res.body.user.email).toBe('erin@test.com');
  });

  test('protected routes reject missing, malformed, and invalid tokens', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'not-bearer-token').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-jwt').expect(401);
  });
});

describe('token refresh (persistent-login renewal)', () => {
  test('POST /auth/refresh reissues a working token for the same user', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Farah', email: 'farah@test.com', password: 'password123' })
      .expect(201);

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    expect(refreshRes.body.token).toEqual(expect.any(String));
    expect(refreshRes.body.user.email).toBe('farah@test.com');
    expect(refreshRes.body.user.id).toBe(reg.body.user.id);

    // The reissued token must itself be a fully working credential, not just
    // a string that happens to be returned — this is what session restore
    // on the client actually depends on.
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshRes.body.token}`)
      .expect(200);
    expect(meRes.body.user.email).toBe('farah@test.com');
  });

  test('POST /auth/refresh rejects missing, malformed, and invalid tokens exactly like other protected routes', async () => {
    await request(app).post('/api/auth/refresh').expect(401);
    await request(app).post('/api/auth/refresh').set('Authorization', 'not-bearer-token').expect(401);
    await request(app).post('/api/auth/refresh').set('Authorization', 'Bearer not-a-real-jwt').expect(401);
  });

  test('the original token keeps working after a refresh (JWTs are stateless — no revocation of the old one)', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Gabe', email: 'gabe@test.com', password: 'password123' })
      .expect(201);

    await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);
  });
});
