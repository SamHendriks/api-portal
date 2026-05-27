const request = require('supertest');
const { app } = require('../server');

// Supertest makes real HTTP requests to our Express app
// without binding to a port — no server needs to be running

describe('POST /auth/register', () => {
  test('registers a new user successfully', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ username: 'sam', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('User registered successfully');
  });

  test('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password required');
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ username: 'sam' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password required');
  });

  test('returns 409 when username is already taken', async () => {
    // Register once
    await request(app)
      .post('/auth/register')
      .send({ username: 'duplicate', password: 'password123' });

    // Try to register again with the same username
    const res = await request(app)
      .post('/auth/register')
      .send({ username: 'duplicate', password: 'different' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already taken');
  });
});


describe('POST /auth/login', () => {
  // Register a user before running the login tests
  beforeAll(async () => {
    await request(app)
      .post('/auth/register')
      .send({ username: 'loginuser', password: 'correct-password' });
  });

  test('returns a JWT token with correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'loginuser', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  test('returns 401 with a wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'loginuser', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('returns 401 for a user that does not exist', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'nobody', password: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });
});


describe('GET /auth/me', () => {
  let token;

  // Register and login to get a real token before these tests
  beforeAll(async () => {
    await request(app)
      .post('/auth/register')
      .send({ username: 'meuser', password: 'mypassword' });

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'meuser', password: 'mypassword' });

    token = res.body.token;
  });

  test('returns 401 with no token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  test('returns 403 with an invalid token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer this.is.not.valid');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  test('returns 200 and username with a valid token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('meuser');
  });
});
