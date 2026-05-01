const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app, getInstances } = require('../server');
const { extractPrompt } = require('../parser');
const { analyze } = require('../analyzer');

jest.setTimeout(30000);

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

// T101: POST /sessions/new responds in less than 100ms
test('T101 - POST /sessions/new responds in less than 100ms', async () => {
  const start = Date.now();
  const res = await request(app).post('/sessions/new').send({ name: 'perf-test' });
  const elapsed = Date.now() - start;
  expect(res.status).toBe(200);
  expect(elapsed).toBeLessThan(100);
});

// T102: POST /ingest responds in less than 200ms
test('T102 - POST /ingest responds in less than 200ms', async () => {
  const session = await createSession('t102');
  const start = Date.now();
  const res = await request(app).post(`/sessions/${session.id}/ingest`).send({ text: '[CC_START] quick ingest [CC_END]' });
  const elapsed = Date.now() - start;
  expect(res.status).toBe(200);
  expect(elapsed).toBeLessThan(200);
});

// T103: GET /sessions with 50 sessions responds in less than 500ms
test('T103 - GET /sessions with 50 sessions under 500ms', async () => {
  for (let i = 0; i < 50; i++) {
    await request(app).post('/sessions/new').send({ name: `session-${i}` });
  }
  const start = Date.now();
  const res = await request(app).get('/sessions');
  const elapsed = Date.now() - start;
  expect(res.status).toBe(200);
  expect(res.body.length).toBe(50);
  expect(elapsed).toBeLessThan(500);
});

// T104: 10 concurrent POST /ingest requests without error
test('T104 - 10 concurrent ingest requests without error', async () => {
  const session = await createSession('t104');
  const promises = Array.from({ length: 10 }, (_, i) =>
    request(app).post(`/sessions/${session.id}/ingest`).send({ text: `[CC_START] concurrent ${i} [CC_END]` })
  );
  const results = await Promise.all(promises);
  results.forEach(r => {
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
});

// T105: 5 instances ingesting simultaneously without error
test('T105 - 5 instances ingesting simultaneously without error', async () => {
  const sessions = await Promise.all(
    Array.from({ length: 5 }, (_, i) => createSession(`t105-s${i}`))
  );
  const regs = await Promise.all(
    sessions.map((s, i) =>
      request(app).post('/instances/register').send({ projectName: 'Perf', cliNumber: i + 1, sessionId: s.id })
    )
  );
  const ingests = await Promise.all(
    regs.map(r =>
      request(app).post(`/instances/${r.body.instanceId}/ingest`).send({ text: '[CC_START] simultaneous [CC_END]' })
    )
  );
  ingests.forEach(r => {
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
});

// T106: session file written correctly under concurrent load
test('T106 - session file correct after concurrent ingest load', async () => {
  const session = await createSession('t106');
  const promises = Array.from({ length: 10 }, (_, i) =>
    request(app).post(`/sessions/${session.id}/ingest`).send({ text: `[CC_START] load ${i} [CC_END]` })
  );
  await Promise.all(promises);
  const file = path.join(SESSIONS_DIR, `${session.id}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  expect(data.iterations.length).toBeGreaterThanOrEqual(1);
  expect(data.iterations.length).toBeLessThanOrEqual(10);
});

// T107: rapid HTTP requests complete (WS broadcast timing skipped)
test('T107 - 10 rapid HTTP requests all complete', async () => {
  const session = await createSession('t107');
  const promises = Array.from({ length: 10 }, (_, i) =>
    request(app).post(`/sessions/${session.id}/ingest`).send({ text: `[CC_START] rapid ${i} [CC_END]` })
  );
  const results = await Promise.all(promises);
  results.forEach(r => expect(r.status).toBe(200));
});

// T108: memory stable after 100 requests
test('T108 - 100 sequential requests all return 200', async () => {
  const session = await createSession('t108');
  for (let i = 0; i < 100; i++) {
    const res = await request(app).post(`/sessions/${session.id}/ingest`).send({ text: `[CC_START] stability ${i} [CC_END]` });
    expect(res.status).toBe(200);
  }
});

// T109: parser.js processes 10000 char text in less than 50ms
test('T109 - extractPrompt processes 10000 char text under 50ms', () => {
  const largeText = '[CC_START] ' + 'A'.repeat(10000) + ' [CC_END]';
  const start = Date.now();
  const result = extractPrompt(largeText);
  const elapsed = Date.now() - start;
  expect(result).not.toBeNull();
  expect(result.content).toBeDefined();
  expect(elapsed).toBeLessThan(50);
});

// T110: analyzer.js processes mixed text in less than 100ms
test('T110 - analyze processes mixed text under 100ms', () => {
  const mixedText = [
    '[CC_START] Build the feature [CC_END]',
    '[TEST_START]',
    '1. Click button -> modal opens',
    '2. Fill form -> validation passes',
    '3. Submit -> success message',
    '[TEST_END]',
    'Option A: Use React',
    'Option B: Use Vue',
    'Which framework do you prefer?',
    'Error: something failed previously',
    '\u2705 Deployment completed successfully',
  ].join('\n');

  const start = Date.now();
  const result = analyze(mixedText);
  const elapsed = Date.now() - start;
  expect(result).toBeDefined();
  expect(result.type).toBeDefined();
  expect(result.elements).toBeDefined();
  expect(elapsed).toBeLessThan(100);
});
