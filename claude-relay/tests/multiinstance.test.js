const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app, getInstances } = require('../server');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

function cleanSessions() {
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    fs.unlinkSync(path.join(SESSIONS_DIR, f));
  }
}

async function createSession(name) {
  const res = await request(app).post('/sessions/new').send({ name });
  return res.body;
}

beforeEach(() => {
  cleanSessions();
  getInstances().clear();
});

afterAll(() => {
  cleanSessions();
  getInstances().clear();
});

// T85: two instances with same projectName + different cliNumber both register OK
test('T85 - two instances same projectName different cliNumber register OK', async () => {
  const session = await createSession('t85-project');
  const resA = await request(app).post('/instances/register').send({ projectName: 'MyProject', cliNumber: 1, sessionId: session.id });
  const resB = await request(app).post('/instances/register').send({ projectName: 'MyProject', cliNumber: 2, sessionId: session.id });
  expect(resA.status).toBe(200);
  expect(resB.status).toBe(200);
  expect(resA.body.instanceId).toBeDefined();
  expect(resB.body.instanceId).toBeDefined();
  expect(resA.body.instanceId).not.toBe(resB.body.instanceId);
});

// T86: exact duplicate projectName+cliNumber returns {already_exists: true}
test('T86 - duplicate projectName+cliNumber returns already_exists', async () => {
  const session = await createSession('t86-project');
  await request(app).post('/instances/register').send({ projectName: 'Dup', cliNumber: 1, sessionId: session.id });
  const res = await request(app).post('/instances/register').send({ projectName: 'Dup', cliNumber: 1, sessionId: session.id });
  expect(res.body.already_exists).toBe(true);
});

// T87: each instance has UUID instanceId
test('T87 - each instance has UUID instanceId', async () => {
  const session = await createSession('t87-project');
  const res = await request(app).post('/instances/register').send({ projectName: 'UUID', cliNumber: 1, sessionId: session.id });
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  expect(res.body.instanceId).toMatch(uuidRegex);
});

// T88: label contains " — CLI-"
test('T88 - label contains CLI marker', async () => {
  const session = await createSession('t88-project');
  const res = await request(app).post('/instances/register').send({ projectName: 'TestProj', cliNumber: 3, sessionId: session.id });
  expect(res.body.label).toContain(' \u2014 CLI-');
});

// T89: label format correct "projectName — CLI-N"
test('T89 - label format is projectName — CLI-N', async () => {
  const session = await createSession('t89-project');
  const res = await request(app).post('/instances/register').send({ projectName: 'Alpha', cliNumber: 7, sessionId: session.id });
  expect(res.body.label).toBe(`Alpha \u2014 CLI-7`);
});

// T90: ingest on instance A doesn't affect instance B's iteration count
test('T90 - ingest on A does not affect B iteration count', async () => {
  const sessionA = await createSession('t90-sessionA');
  const sessionB = await createSession('t90-sessionB');
  const regA = await request(app).post('/instances/register').send({ projectName: 'Proj', cliNumber: 1, sessionId: sessionA.id });
  const regB = await request(app).post('/instances/register').send({ projectName: 'Proj', cliNumber: 2, sessionId: sessionB.id });

  await request(app).post(`/instances/${regA.body.instanceId}/ingest`).send({ text: '[CC_START] hello A [CC_END]' });

  const sA = await request(app).get(`/sessions/${sessionA.id}`);
  const sB = await request(app).get(`/sessions/${sessionB.id}`);
  expect(sA.body.iterations.length).toBe(1);
  expect(sB.body.iterations.length).toBe(0);

  await request(app).post(`/instances/${regB.body.instanceId}/ingest`).send({ text: '[CC_START] hello B [CC_END]' });
  const sB2 = await request(app).get(`/sessions/${sessionB.id}`);
  expect(sB2.body.iterations.length).toBe(1);
});

// T91: result on instance A saves correctly
test('T91 - result on instance A saves correctly', async () => {
  const session = await createSession('t91-project');
  const reg = await request(app).post('/instances/register').send({ projectName: 'Res', cliNumber: 1, sessionId: session.id });
  await request(app).post(`/instances/${reg.body.instanceId}/ingest`).send({ text: '[CC_START] do something [CC_END]' });
  await request(app).post(`/instances/${reg.body.instanceId}/result`).send({ result: 'Done successfully' });

  const file = path.join(SESSIONS_DIR, `${session.id}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  expect(data.iterations[0].result).toBe('Done successfully');
});

// T92: response from instance ingest contains the analysis
test('T92 - instance ingest response contains analysis', async () => {
  const session = await createSession('t92-project');
  const reg = await request(app).post('/instances/register').send({ projectName: 'Ana', cliNumber: 1, sessionId: session.id });
  const res = await request(app).post(`/instances/${reg.body.instanceId}/ingest`).send({ text: '[CC_START] analyze this [CC_END]' });
  expect(res.body.success).toBe(true);
  expect(res.body.analysis).toBeDefined();
  expect(res.body.analysis.type).toBeDefined();
});

// T93: 5 instances registered simultaneously without conflict
test('T93 - 5 instances registered simultaneously without conflict', async () => {
  const session = await createSession('t93-project');
  const promises = Array.from({ length: 5 }, (_, i) =>
    request(app).post('/instances/register').send({ projectName: 'Parallel', cliNumber: i + 1, sessionId: session.id })
  );
  const results = await Promise.all(promises);
  const ids = results.map(r => r.body.instanceId);
  expect(new Set(ids).size).toBe(5);
  results.forEach(r => expect(r.status).toBe(200));
});

// T94: DELETE instance A, instance B still in GET /instances
test('T94 - delete A, B still present', async () => {
  const session = await createSession('t94-project');
  const regA = await request(app).post('/instances/register').send({ projectName: 'Del', cliNumber: 1, sessionId: session.id });
  const regB = await request(app).post('/instances/register').send({ projectName: 'Del', cliNumber: 2, sessionId: session.id });
  await request(app).delete(`/instances/${regA.body.instanceId}`);
  const res = await request(app).get('/instances');
  const ids = res.body.map(i => i.instanceId);
  expect(ids).not.toContain(regA.body.instanceId);
  expect(ids).toContain(regB.body.instanceId);
});

// T95: GET /instances after delete returns N-1
test('T95 - instances count decreases after delete', async () => {
  const session = await createSession('t95-project');
  const regs = [];
  for (let i = 1; i <= 3; i++) {
    const r = await request(app).post('/instances/register').send({ projectName: 'Count', cliNumber: i, sessionId: session.id });
    regs.push(r.body);
  }
  const before = await request(app).get('/instances');
  expect(before.body.length).toBe(3);
  await request(app).delete(`/instances/${regs[0].instanceId}`);
  const after = await request(app).get('/instances');
  expect(after.body.length).toBe(2);
});

// T96: instance linked to invalid sessionId returns 404
test('T96 - register with invalid sessionId returns 404', async () => {
  const res = await request(app).post('/instances/register').send({ projectName: 'Bad', cliNumber: 1, sessionId: 'nonexistent-id' });
  expect(res.status).toBe(404);
});

// T97: status changes to "waiting_result" after ingest
test('T97 - status is waiting_result after ingest', async () => {
  const session = await createSession('t97-project');
  const reg = await request(app).post('/instances/register').send({ projectName: 'Status', cliNumber: 1, sessionId: session.id });
  await request(app).post(`/instances/${reg.body.instanceId}/ingest`).send({ text: '[CC_START] check status [CC_END]' });
  const res = await request(app).get(`/instances/${reg.body.instanceId}/status`);
  expect(res.body.status).toBe('waiting_result');
});

// T98: status returns to "idle" after result
test('T98 - status returns to idle after result', async () => {
  const session = await createSession('t98-project');
  const reg = await request(app).post('/instances/register').send({ projectName: 'Idle', cliNumber: 1, sessionId: session.id });
  await request(app).post(`/instances/${reg.body.instanceId}/ingest`).send({ text: '[CC_START] work [CC_END]' });
  await request(app).post(`/instances/${reg.body.instanceId}/result`).send({ result: 'done' });
  const res = await request(app).get(`/instances/${reg.body.instanceId}/status`);
  expect(res.body.status).toBe('idle');
});

// T99: lastActiveAt updated after action
test('T99 - lastActiveAt updated after ingest', async () => {
  const session = await createSession('t99-project');
  const reg = await request(app).post('/instances/register').send({ projectName: 'Time', cliNumber: 1, sessionId: session.id });
  const createdAt = new Date(reg.body.createdAt || new Date().toISOString()).getTime();
  await new Promise(r => setTimeout(r, 15));
  await request(app).post(`/instances/${reg.body.instanceId}/ingest`).send({ text: '[CC_START] timing [CC_END]' });
  const res = await request(app).get(`/instances/${reg.body.instanceId}/status`);
  const lastActive = new Date(res.body.lastActiveAt).getTime();
  expect(lastActive).toBeGreaterThan(createdAt);
});

// T100: parallel ingest on 3 instances all succeed
test('T100 - parallel ingest on 3 instances all succeed', async () => {
  const sessions = await Promise.all([
    createSession('t100-s1'),
    createSession('t100-s2'),
    createSession('t100-s3'),
  ]);
  const regs = await Promise.all(
    sessions.map((s, i) =>
      request(app).post('/instances/register').send({ projectName: 'Para', cliNumber: i + 1, sessionId: s.id })
    )
  );
  const ingests = await Promise.all(
    regs.map(r =>
      request(app).post(`/instances/${r.body.instanceId}/ingest`).send({ text: '[CC_START] parallel work [CC_END]' })
    )
  );
  ingests.forEach(r => {
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
});
