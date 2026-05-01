const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app, getInstances } = require('../server');

const sessionsDir = path.join(__dirname, '..', 'sessions');

function clearSessions() {
  fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .forEach(f => fs.unlinkSync(path.join(sessionsDir, f)));
}

beforeEach(() => {
  clearSessions();
  getInstances().clear();
});

afterAll(() => {
  clearSessions();
  getInstances().clear();
});

// Helper: create a session and return its id
async function createSession(name = 'Test Session') {
  const res = await request(app).post('/sessions/new').send({ name });
  return res.body;
}

// Helper: ingest text into a session
async function ingestText(sessionId, text) {
  return request(app).post(`/sessions/${sessionId}/ingest`).send({ text });
}

// ── T43-T44: GET / ──

test('T43: GET / responds 200 with HTML containing "Claude Relay"', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.text).toContain('Claude Relay');
});

test('T44: GET / Content-Type is text/html', async () => {
  const res = await request(app).get('/');
  expect(res.headers['content-type']).toMatch(/text\/html/);
});

// ── T45-T47: GET /sessions ──

test('T45: GET /sessions responds 200 with JSON array', async () => {
  const res = await request(app).get('/sessions');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('T46: GET /sessions returns empty array when no sessions', async () => {
  const res = await request(app).get('/sessions');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('T47: GET /sessions returns sessions sorted by updatedAt desc', async () => {
  const s1 = await createSession('First');
  // Small delay to ensure different updatedAt
  await new Promise(r => setTimeout(r, 50));
  const s2 = await createSession('Second');

  const res = await request(app).get('/sessions');
  expect(res.status).toBe(200);
  expect(res.body.length).toBe(2);
  // Second created later, should be first in sorted list
  expect(res.body[0].id).toBe(s2.id);
  expect(res.body[1].id).toBe(s1.id);
});

// ── T48-T52: POST /sessions/new ──

test('T48: POST /sessions/new responds 200 with {id, name, createdAt}', async () => {
  const res = await request(app).post('/sessions/new').send({ name: 'My Session' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id');
  expect(res.body).toHaveProperty('name', 'My Session');
  expect(res.body).toHaveProperty('createdAt');
});

test('T49: POST /sessions/new creates JSON file in sessions/', async () => {
  const res = await request(app).post('/sessions/new').send({ name: 'File Test' });
  const filePath = path.join(sessionsDir, `${res.body.id}.json`);
  expect(fs.existsSync(filePath)).toBe(true);
});

test('T50: POST /sessions/new id is UUID v4 format', async () => {
  const res = await request(app).post('/sessions/new').send({ name: 'UUID Test' });
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  expect(res.body.id).toMatch(uuidV4Regex);
});

test('T51: POST /sessions/new responds 400 if name missing', async () => {
  const res = await request(app).post('/sessions/new').send({});
  expect(res.status).toBe(400);
});

test('T52: POST /sessions/new responds 400 if name is empty string', async () => {
  const res = await request(app).post('/sessions/new').send({ name: '' });
  expect(res.status).toBe(400);
});

// ── T53-T55: GET /sessions/:id ──

test('T53: GET /sessions/:id responds 200 with full session', async () => {
  const { id } = await createSession('Detail Test');
  const res = await request(app).get(`/sessions/${id}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id', id);
  expect(res.body).toHaveProperty('name', 'Detail Test');
  expect(res.body).toHaveProperty('iterations');
  expect(res.body).toHaveProperty('status');
});

test('T54: GET /sessions/:id responds 404 for non-existent session', async () => {
  const res = await request(app).get('/sessions/00000000-0000-4000-8000-000000000000');
  expect(res.status).toBe(404);
});

test('T55: GET /sessions/:id iterations is empty array initially', async () => {
  const { id } = await createSession('Empty Iterations');
  const res = await request(app).get(`/sessions/${id}`);
  expect(res.body.iterations).toEqual([]);
});

// ── T56-T60: POST /sessions/:id/ingest ──

test('T56: POST /sessions/:id/ingest responds 200 with {success, analysis}', async () => {
  const { id } = await createSession('Ingest Test');
  const res = await ingestText(id, 'Hello world');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('success', true);
  expect(res.body).toHaveProperty('analysis');
});

test('T57: POST /sessions/:id/ingest analysis.type is "prompt" with [CC_START]...[CC_END]', async () => {
  const { id } = await createSession('Prompt Type');
  const res = await ingestText(id, '[CC_START]Do something[CC_END]');
  expect(res.body.analysis.type).toBe('prompt');
});

test('T58: POST /sessions/:id/ingest creates iteration in session', async () => {
  const { id } = await createSession('Iteration Check');
  await ingestText(id, 'Some text here');
  const session = await request(app).get(`/sessions/${id}`);
  expect(session.body.iterations.length).toBe(1);
  expect(session.body.iterations[0]).toHaveProperty('rawInput', 'Some text here');
});

test('T59: POST /sessions/:id/ingest responds 400 if text missing', async () => {
  const { id } = await createSession('No Text');
  const res = await request(app).post(`/sessions/${id}/ingest`).send({});
  expect(res.status).toBe(400);
});

test('T60: POST /sessions/:id/ingest responds 404 for invalid sessionId', async () => {
  const res = await ingestText('nonexistent-id', 'Hello');
  expect(res.status).toBe(404);
});

// ── T61-T63: POST /sessions/:id/result ──

test('T61: POST /sessions/:id/result responds 200 with {success, nextIteration}', async () => {
  const { id } = await createSession('Result Test');
  await ingestText(id, 'Some input');
  const res = await request(app).post(`/sessions/${id}/result`).send({ result: 'Done' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('success', true);
  expect(res.body).toHaveProperty('nextIteration');
});

test('T62: POST /sessions/:id/result increments currentIteration', async () => {
  const { id } = await createSession('Increment Test');
  await ingestText(id, 'Input');
  const before = (await request(app).get(`/sessions/${id}`)).body.currentIteration;
  await request(app).post(`/sessions/${id}/result`).send({ result: 'Result' });
  const after = (await request(app).get(`/sessions/${id}`)).body.currentIteration;
  expect(after).toBe(before + 1);
});

test('T63: POST /sessions/:id/result responds 400 if result missing', async () => {
  const { id } = await createSession('No Result');
  await ingestText(id, 'Input');
  const res = await request(app).post(`/sessions/${id}/result`).send({});
  expect(res.status).toBe(400);
});

// ── T64-T65: POST /sessions/:id/option ──

test('T64: POST /sessions/:id/option responds 200 with {success, generatedPrompt}', async () => {
  const { id } = await createSession('Option Test');
  await ingestText(id, 'Some input');
  const res = await request(app).post(`/sessions/${id}/option`).send({ chosenOption: 'Option A' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('success', true);
  expect(res.body).toHaveProperty('generatedPrompt');
});

test('T65: POST /sessions/:id/option generatedPrompt is non-empty string', async () => {
  const { id } = await createSession('Prompt Check');
  await ingestText(id, 'Some input');
  const res = await request(app).post(`/sessions/${id}/option`).send({ chosenOption: 'Option B' });
  expect(typeof res.body.generatedPrompt).toBe('string');
  expect(res.body.generatedPrompt.length).toBeGreaterThan(0);
});

// ── T66-T67: POST /sessions/:id/complete ──

test('T66: POST /sessions/:id/complete responds 200', async () => {
  const { id } = await createSession('Complete Test');
  const res = await request(app).post(`/sessions/${id}/complete`).send();
  expect(res.status).toBe(200);
});

test('T67: POST /sessions/:id/complete sets status to "completed"', async () => {
  const { id } = await createSession('Status Check');
  await request(app).post(`/sessions/${id}/complete`).send();
  const session = (await request(app).get(`/sessions/${id}`)).body;
  expect(session.status).toBe('completed');
});

// ── T68-T69: GET /sessions/:id/history ──

test('T68: GET /sessions/:id/history responds 200 with {id, name, iterations}', async () => {
  const { id } = await createSession('History Test');
  const res = await request(app).get(`/sessions/${id}/history`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id', id);
  expect(res.body).toHaveProperty('name', 'History Test');
  expect(res.body).toHaveProperty('iterations');
});

test('T69: GET /sessions/:id/history iterations contains all entries', async () => {
  const { id } = await createSession('History Entries');
  await ingestText(id, 'First input');
  await request(app).post(`/sessions/${id}/result`).send({ result: 'First result' });
  await ingestText(id, 'Second input');
  const res = await request(app).get(`/sessions/${id}/history`);
  expect(res.body.iterations.length).toBe(2);
});

// ── T70-T72: Instances ──

test('T70: POST /instances/register responds 200 with {instanceId, label}', async () => {
  const { id } = await createSession('Instance Session');
  const res = await request(app).post('/instances/register').send({
    projectName: 'TestProject',
    cliNumber: 1,
    sessionId: id
  });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('instanceId');
  expect(res.body).toHaveProperty('label');
  getInstances().clear();
});

test('T71: POST /instances/register label format is "projectName — CLI-N"', async () => {
  const { id } = await createSession('Label Session');
  const res = await request(app).post('/instances/register').send({
    projectName: 'MyProject',
    cliNumber: 3,
    sessionId: id
  });
  expect(res.body.label).toContain('MyProject');
  expect(res.body.label).toContain('CLI-3');
  getInstances().clear();
});

test('T72: GET /instances returns registered instance', async () => {
  const { id } = await createSession('List Instance');
  const reg = await request(app).post('/instances/register').send({
    projectName: 'ListTest',
    cliNumber: 1,
    sessionId: id
  });
  const res = await request(app).get('/instances');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeGreaterThanOrEqual(1);
  expect(res.body.find(i => i.instanceId === reg.body.instanceId)).toBeTruthy();
  getInstances().clear();
});
