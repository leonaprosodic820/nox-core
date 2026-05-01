const { server, app, wss, getInstances } = require('../server');
const WebSocket = require('ws');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const http = require('http');

const sessionsDir = path.join(__dirname, '..', 'sessions');

let testServer;
let port;

function clearSessions() {
  fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .forEach(f => fs.unlinkSync(path.join(sessionsDir, f)));
}

beforeAll(done => {
  testServer = server.listen(0, () => {
    port = testServer.address().port;
    done();
  });
});

beforeEach(() => {
  clearSessions();
  getInstances().clear();
});

afterAll(done => {
  clearSessions();
  getInstances().clear();
  wss.clients.forEach(c => c.close());
  testServer.close(done);
});

// Creates a WS client and waits for the initial "connected" message
// so subsequent waitForMessage calls only see broadcast events.
function createWSClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('error', reject);
    ws.on('message', function onFirst(raw) {
      const data = JSON.parse(raw.toString());
      if (data.event === 'connected') {
        ws.removeListener('message', onFirst);
        resolve(ws);
      }
    });
  });
}

function waitForMessage(ws, filter, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS timeout')), timeout);
    ws.on('message', function handler(raw) {
      const data = JSON.parse(raw.toString());
      if (!filter || filter(data)) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(data);
      }
    });
  });
}

function httpPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port, path: urlPath }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    }).on('error', reject);
  });
}

function httpDelete(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port, path: urlPath, method: 'DELETE'
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function createSession(name = 'WS Test') {
  return httpPost('/sessions/new', { name });
}

// ── T73: WS connection established ──

test('T73: WS connection established', async () => {
  const ws = await createWSClient();
  expect(ws.readyState).toBe(WebSocket.OPEN);
  ws.close();
});

// ── T74: event "analyzed" received after POST /sessions/:id/ingest ──

test('T74: event "analyzed" received after ingest', async () => {
  const ws = await createWSClient();
  const { id } = await createSession();
  const msgPromise = waitForMessage(ws, d => d.event === 'analyzed');
  await httpPost(`/sessions/${id}/ingest`, { text: 'Hello world' });
  const data = await msgPromise;
  expect(data.event).toBe('analyzed');
  expect(data.sessionId).toBe(id);
  ws.close();
});

// ── T75: event "result_saved" received after POST /sessions/:id/result ──

test('T75: event "result_saved" received after result', async () => {
  const ws = await createWSClient();
  const { id } = await createSession();

  // Must ingest first to create iteration
  const ingestPromise = waitForMessage(ws, d => d.event === 'analyzed');
  await httpPost(`/sessions/${id}/ingest`, { text: 'Input' });
  await ingestPromise;

  const msgPromise = waitForMessage(ws, d => d.event === 'result_saved');
  await httpPost(`/sessions/${id}/result`, { result: 'Done' });
  const data = await msgPromise;
  expect(data.event).toBe('result_saved');
  expect(data.sessionId).toBe(id);
  ws.close();
});

// ── T76: event "option_chosen" received after POST /sessions/:id/option ──

test('T76: event "option_chosen" received after option', async () => {
  const ws = await createWSClient();
  const { id } = await createSession();

  const ingestPromise = waitForMessage(ws, d => d.event === 'analyzed');
  await httpPost(`/sessions/${id}/ingest`, { text: 'Input' });
  await ingestPromise;

  const msgPromise = waitForMessage(ws, d => d.event === 'option_chosen');
  await httpPost(`/sessions/${id}/option`, { chosenOption: 'A' });
  const data = await msgPromise;
  expect(data.event).toBe('option_chosen');
  expect(data.sessionId).toBe(id);
  ws.close();
});

// ── T77: event "session_completed" received after POST /sessions/:id/complete ──

test('T77: event "session_completed" received after complete', async () => {
  const ws = await createWSClient();
  const { id } = await createSession();

  const msgPromise = waitForMessage(ws, d => d.event === 'session_completed');
  await httpPost(`/sessions/${id}/complete`, {});
  const data = await msgPromise;
  expect(data.event).toBe('session_completed');
  expect(data.sessionId).toBe(id);
  ws.close();
});

// ── T78: event "instance_registered" received after POST /instances/register ──

test('T78: event "instance_registered" received after register', async () => {
  const ws = await createWSClient();
  const { id } = await createSession();

  const msgPromise = waitForMessage(ws, d => d.event === 'instance_registered');
  await httpPost('/instances/register', { projectName: 'WSTest', cliNumber: 1, sessionId: id });
  const data = await msgPromise;
  expect(data.event).toBe('instance_registered');
  expect(data.instance).toHaveProperty('instanceId');
  ws.close();
});

// ── T79: event "instance_removed" received after DELETE /instances/:id ──

test('T79: event "instance_removed" received after delete instance', async () => {
  const ws = await createWSClient();
  const { id } = await createSession();

  // Set up listener for instance_registered BEFORE triggering register
  const regPromise = waitForMessage(ws, d => d.event === 'instance_registered');
  const regRes = await httpPost('/instances/register', { projectName: 'DelTest', cliNumber: 1, sessionId: id });
  await regPromise;

  const msgPromise = waitForMessage(ws, d => d.event === 'instance_removed');
  await httpDelete(`/instances/${regRes.instanceId}`);
  const data = await msgPromise;
  expect(data.event).toBe('instance_removed');
  expect(data.instanceId).toBe(regRes.instanceId);
  ws.close();
});

// ── T80: two WS clients receive same broadcast ──

test('T80: two WS clients receive same broadcast', async () => {
  const { id } = await createSession();
  const ws1 = await createWSClient();
  const ws2 = await createWSClient();

  const p1 = waitForMessage(ws1, d => d.event === 'analyzed');
  const p2 = waitForMessage(ws2, d => d.event === 'analyzed');
  httpPost(`/sessions/${id}/ingest`, { text: 'Broadcast test' });

  const [d1, d2] = await Promise.all([p1, p2]);
  expect(d1.event).toBe('analyzed');
  expect(d2.event).toBe('analyzed');
  expect(d1.sessionId).toBe(d2.sessionId);
  ws1.close(); ws2.close();
});

// ── T81: payload contains instanceId when instance is concerned ──

test('T81: payload contains instanceId when instance is concerned', async () => {
  const { id } = await createSession();
  const regRes = await httpPost('/instances/register', { projectName: 'InstTest', cliNumber: 1, sessionId: id });

  const ws = await createWSClient();
  const msgPromise = waitForMessage(ws, d => d.event === 'analyzed');
  httpPost(`/instances/${regRes.instanceId}/ingest`, { text: 'Instance ingest' });
  const data = await msgPromise;
  expect(data.instanceId).toBe(regRes.instanceId);
  ws.close();
});

// ── T82: after ws.close() a new client can connect ──

test('T82: after ws.close() a new client can connect', async () => {
  const ws1 = await createWSClient();
  ws1.close();
  await new Promise(r => setTimeout(r, 100));
  const ws2 = await createWSClient();
  expect(ws2.readyState).toBe(WebSocket.OPEN);
  ws2.close();
});

// ── T83: no crash on 50 rapid connections/disconnections ──

test('T83: no crash on 50 rapid connections/disconnections', async () => {
  const clients = [];
  for (let i = 0; i < 50; i++) {
    clients.push(new WebSocket(`ws://localhost:${port}`));
  }
  await new Promise(r => setTimeout(r, 500));
  clients.forEach(ws => ws.close());
  await new Promise(r => setTimeout(r, 200));

  // Server should still respond
  const res = await httpGet('/sessions');
  expect(Array.isArray(res)).toBe(true);
}, 10000);

// ── T84: malformed non-JSON sent to WS doesn't crash server ──

test('T84: malformed non-JSON sent to WS does not crash server', async () => {
  const ws = await createWSClient();
  ws.send('not json {{{');
  ws.send('');
  ws.send('12345');
  await new Promise(r => setTimeout(r, 200));
  ws.close();

  // Server still works
  const res = await httpGet('/sessions');
  expect(Array.isArray(res)).toBe(true);
});
