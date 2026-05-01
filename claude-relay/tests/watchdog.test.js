const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

const {
  checkHealth,
  logHealth,
  startHealthChecks,
  stopHealthChecks,
  cleanupOldFiles,
  getSessionsDiskUsage,
  getFullStatus
} = require('../watchdog');

let server;
let testPort;

beforeAll((done) => {
  // Start the relay server on a random port
  const app = require('../server');
  server = app.server;
  // If server is already listening, close and re-listen on port 0
  try { server.close(); } catch {}
  server.listen(0, () => {
    testPort = server.address().port;
    done();
  });
});

afterAll((done) => {
  stopHealthChecks();
  if (server) {
    server.close(done);
  } else {
    done();
  }
});

beforeEach(() => {
  // Clean logs/health.log
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const healthLog = path.join(LOGS_DIR, 'health.log');
  if (fs.existsSync(healthLog)) {
    fs.unlinkSync(healthLog);
  }
});

// T181
test('T181: checkHealth on running server returns healthy:true', async () => {
  const result = await checkHealth(testPort);
  expect(result.healthy).toBe(true);
});

// T182
test('T182: checkHealth on non-running port returns healthy:false', async () => {
  const result = await checkHealth(59999);
  expect(result.healthy).toBe(false);
});

// T183
test('T183: getFullStatus returns object with healthy, disk, uptimeMs, pid, memory', async () => {
  const status = await getFullStatus(testPort);
  expect(status).toHaveProperty('healthy');
  expect(status).toHaveProperty('disk');
  expect(status).toHaveProperty('uptimeMs');
  expect(status).toHaveProperty('pid');
  expect(status).toHaveProperty('memory');
});

// T184
test('T184: logHealth writes to logs/health.log', () => {
  const checks = {
    timestamp: new Date().toISOString(),
    healthy: true,
    server: true,
    uptime: 100,
    sessions: 0
  };
  logHealth(checks);
  const logFile = path.join(LOGS_DIR, 'health.log');
  expect(fs.existsSync(logFile)).toBe(true);
  const content = fs.readFileSync(logFile, 'utf-8');
  expect(content).toContain('healthy=true');
});

// T185
test.todo('T185: PM2 relance le serveur apres kill simule');

// T186
test.todo('T186: pm2 status retourne online');

// T187
test.todo('T187: pm2 logs sans erreur');

// T188
test('T188: checkHealth responds within 5000ms', async () => {
  const start = Date.now();
  await checkHealth(testPort);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(5000);
});

// T189
test('T189: getFullStatus().uptimeMs > 0', async () => {
  const status = await getFullStatus(testPort);
  expect(status.uptimeMs).toBeGreaterThan(0);
});

// T190
test('T190: getSessionsDiskUsage returns {bytes: number, mb: number}', () => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const usage = getSessionsDiskUsage();
  expect(typeof usage.bytes).toBe('number');
  expect(typeof usage.mb).toBe('number');
});
