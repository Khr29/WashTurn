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
