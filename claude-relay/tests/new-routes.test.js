const { app, server, wss, getInstances, getAutoMode } = require('../server');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const sessionsDir = path.join(__dirname, '..', 'sessions');
const decisionsDir = path.join(__dirname, '..', 'decisions');
const projectsDir = path.join(__dirname, '..', 'projects');

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => fs.unlinkSync(path.join(dir, f)));
}

beforeEach(() => {
  cleanDir(sessionsDir);
  cleanDir(decisionsDir);
  cleanDir(projectsDir);
  getInstances().clear();
  getAutoMode().clear();
});

afterAll(() => {
  cleanDir(sessionsDir);
  cleanDir(decisionsDir);
  cleanDir(projectsDir);
});

test('GET /brain/status returns brain availability', async () => {
  const res = await request(app).get('/brain/status');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('available');
  expect(res.body).toHaveProperty('model');
  expect(res.body).toHaveProperty('totalDecisions');
});

test('POST /brain/decide returns decision for text', async () => {
  const res = await request(app).post('/brain/decide').send({ text: '[CC_START]\necho test\n[CC_END]' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.decision).toHaveProperty('decision');
  expect(res.body.decision).toHaveProperty('confidence');
});

test('POST /brain/decide returns 400 without text', async () => {
  const res = await request(app).post('/brain/decide').send({});
  expect(res.status).toBe(400);
});

test('GET /decisions returns array', async () => {
  const res = await request(app).get('/decisions');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /decisions/:sessionId filters by session', async () => {
  const res = await request(app).get('/decisions/fake-session');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /projects returns array', async () => {
  const res = await request(app).get('/projects');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /projects/:name creates and returns project', async () => {
  const res = await request(app).get('/projects/test-proj');
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('test-proj');
  expect(res.body).toHaveProperty('objective');
  expect(res.body).toHaveProperty('techStack');
});

test('POST /projects/:name/objective sets objective', async () => {
  const res = await request(app).post('/projects/test-proj/objective').send({ objective: 'Build a REST API' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);

  const get = await request(app).get('/projects/test-proj');
  expect(get.body.objective).toBe('Build a REST API');
});

test('POST /projects/:name/objective returns 400 without objective', async () => {
  const res = await request(app).post('/projects/test-proj/objective').send({});
  expect(res.status).toBe(400);
});

test('GET /health returns status', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('brain');
  expect(res.body).toHaveProperty('instances');
});

test('POST /instances/:id/auto-mode enables auto mode', async () => {
  const sess = await request(app).post('/sessions/new').send({ name: 'auto-test' });
  const inst = await request(app).post('/instances/register').send({ projectName: 'auto', cliNumber: 1, sessionId: sess.body.id });

  const res = await request(app).post(`/instances/${inst.body.instanceId}/auto-mode`).send({ enabled: true });
  expect(res.status).toBe(200);
  expect(res.body.autoMode).toBe(true);

  const res2 = await request(app).post(`/instances/${inst.body.instanceId}/auto-mode`).send({ enabled: false });
  expect(res2.body.autoMode).toBe(false);
});

test('POST /instances/:id/auto-mode returns 404 for invalid instance', async () => {
  const res = await request(app).post('/instances/fake-id/auto-mode').send({ enabled: true });
  expect(res.status).toBe(404);
});

test('POST /validate approves safe request', async () => {
  const res = await request(app).post('/validate').send({ request: 'Do you want to proceed?' });
  expect(res.status).toBe(200);
  expect(res.body.approved).toBe(true);
});

test('POST /validate blocks dangerous request', async () => {
  const res = await request(app).post('/validate').send({ request: 'rm -rf /' });
  expect(res.status).toBe(200);
  expect(res.body.approved).toBe(false);
});

test('POST /validate returns 400 without request', async () => {
  const res = await request(app).post('/validate').send({});
  expect(res.status).toBe(400);
});

test('GET /relay/stats returns stats', async () => {
  const res = await request(app).get('/relay/stats');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('uptime');
  expect(res.body).toHaveProperty('totalSessions');
  expect(res.body).toHaveProperty('activeInstances');
  expect(res.body).toHaveProperty('autoModeInstances');
  expect(typeof res.body.uptime).toBe('number');
});
