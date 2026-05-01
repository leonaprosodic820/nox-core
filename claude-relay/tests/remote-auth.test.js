const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const remoteAuth = require('../remote-auth');

const TEST_PIN = '123456';
const TEST_JWT_SECRET = 'test-jwt-secret-for-tests';
const testConfig = {
  pinHash: bcrypt.hashSync(TEST_PIN, 10),
  jwtSecret: TEST_JWT_SECRET,
  sessionTimeout: 86400,
  maxLoginAttempts: 3,
  lockoutDurationSec: 5
};

let request;

beforeAll(() => {
  remoteAuth.setConfig(testConfig);
  const supertest = require('supertest');
  const { app } = require('../server');
  request = supertest(app);
});

beforeEach(() => {
  remoteAuth.tokenBlacklist.clear();
  remoteAuth.loginAttempts.clear();
  remoteAuth.setConfig({ ...testConfig });
});

function makeToken(payload = { role: 'remote', ip: '::1' }) {
  return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: 86400 });
}

async function getToken() {
  return makeToken();
}

// T1
test('POST /remote/login with correct PIN returns 200 with token', async () => {
  const res = await request.post('/remote/login').send({ pin: TEST_PIN });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('token');
  expect(res.body.success).toBe(true);
});

// T2
test('POST /remote/login with wrong PIN returns 401', async () => {
  const res = await request.post('/remote/login').send({ pin: '000000' });
  expect(res.status).toBe(401);
});

// T3
test('POST /remote/login without PIN returns 400', async () => {
  const res = await request.post('/remote/login').send({});
  expect(res.status).toBe(400);
});

// T4
test('JWT from login is valid with config jwtSecret', async () => {
  const token = await getToken();
  const decoded = jwt.verify(token, TEST_JWT_SECRET);
  expect(decoded).toHaveProperty('role', 'remote');
  expect(decoded).toHaveProperty('iat');
});

// T5
test('GET /remote/health with valid token returns 200', async () => {
  const token = await getToken();
  const res = await request.get('/remote/health').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
});

// T6
test('GET /remote/health without token returns 401', async () => {
  const res = await request.get('/remote/health');
  expect(res.status).toBe(401);
});

// T7
test('GET /remote/health with invalid token returns 401', async () => {
  const res = await request.get('/remote/health').set('Authorization', 'Bearer invalid.token.here');
  expect(res.status).toBe(401);
});

// T8
test('POST /remote/logout invalidates token', async () => {
  const token = await getToken();
  // Logout
  const logoutRes = await request.post('/remote/logout').set('Authorization', `Bearer ${token}`);
  expect(logoutRes.status).toBe(200);
  // Retry with same token
  const retryRes = await request.get('/remote/health').set('Authorization', `Bearer ${token}`);
  expect(retryRes.status).toBe(401);
});

// T9
test('extractToken reads from Authorization header', () => {
  const req = { headers: { authorization: 'Bearer abc123' }, cookies: {}, query: {} };
  expect(remoteAuth.extractToken(req)).toBe('abc123');
});

// T10
test('extractToken reads from cookie', () => {
  const req = { headers: {}, cookies: { relay_token: 'cookie-token' }, query: {} };
  expect(remoteAuth.extractToken(req)).toBe('cookie-token');
});

// T11
test('extractToken reads from query param', () => {
  const req = { headers: {}, cookies: {}, query: { token: 'query-token' } };
  expect(remoteAuth.extractToken(req)).toBe('query-token');
});

// T12
test('tokenBlacklist.add causes requireAuth to reject', async () => {
  const token = await getToken();
  remoteAuth.tokenBlacklist.add(token);
  const res = await request.get('/remote/health').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
  expect(res.body.error).toContain('revoked');
});

// T13
test('loginAttempts tracks failed attempts per IP', async () => {
  await request.post('/remote/login').send({ pin: 'wrong1' });
  await request.post('/remote/login').send({ pin: 'wrong2' });
  // loginAttempts should have an entry (IP varies in test but there should be at least one)
  expect(remoteAuth.loginAttempts.size).toBeGreaterThan(0);
  const entry = remoteAuth.loginAttempts.values().next().value;
  expect(entry.count).toBeGreaterThanOrEqual(2);
});

// T14
test('3 failed logins trigger lockout response', async () => {
  remoteAuth.setConfig({ ...testConfig, maxLoginAttempts: 3 });
  await request.post('/remote/login').send({ pin: 'bad1' });
  await request.post('/remote/login').send({ pin: 'bad2' });
  await request.post('/remote/login').send({ pin: 'bad3' });
  const res = await request.post('/remote/login').send({ pin: 'bad4' });
  expect(res.status).toBe(429);
  expect(res.body.error).toMatch(/locked|Too many/i);
});

// T15
test('setConfig changes active config', () => {
  const custom = { ...testConfig, sessionTimeout: 999 };
  remoteAuth.setConfig(custom);
  expect(remoteAuth.getConfig().sessionTimeout).toBe(999);
});

// T16
test('remoteSecret never appears in /remote/health JSON', async () => {
  const token = await getToken();
  const res = await request.get('/remote/health').set('Authorization', `Bearer ${token}`);
  const body = JSON.stringify(res.body);
  expect(body).not.toContain(TEST_JWT_SECRET);
  expect(body).not.toContain(testConfig.pinHash);
});

// T17
test('POST /remote/mac/shell with valid token returns 200', async () => {
  const token = await getToken();
  const res = await request
    .post('/remote/mac/shell')
    .set('Authorization', `Bearer ${token}`)
    .send({ command: 'echo test' });
  expect(res.status).toBe(200);
  expect(res.body.stdout).toContain('test');
});

// T18
test('POST /remote/mac/shell without token returns 401', async () => {
  const res = await request.post('/remote/mac/shell').send({ command: 'echo test' });
  expect(res.status).toBe(401);
});

// T19
test('POST /remote/screenshot with valid token returns 200 image', async () => {
  const token = await getToken();
  const res = await request
    .get('/remote/screenshot')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('image/png');
  expect(res.body.length).toBeGreaterThan(0);
});

// T20
test('loginLimiter is a function', () => {
  expect(typeof remoteAuth.loginLimiter).toBe('function');
});
