const http = require('http');
const fs = require('fs');
const path = require('path');
const { notify } = require('./notifier');

const LOGS_DIR = path.join(__dirname, 'logs');
const SESSIONS_DIR = path.join(__dirname, 'sessions');

let healthInterval = null;
let cleanupInterval = null;
const startTime = Date.now();

function checkHealth(port = 7777) {
  return new Promise(resolve => {
    const checks = { server: false, timestamp: new Date().toISOString(), uptime: process.uptime() };

    const req = http.get({ hostname: 'localhost', port, path: '/sessions', timeout: 3000 }, res => {
      checks.server = res.statusCode === 200;
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          checks.sessions = JSON.parse(body).length;
        } catch { checks.sessions = 0; }
        checks.healthy = checks.server;
        resolve(checks);
      });
    });

    req.on('error', () => {
      checks.server = false;
      checks.healthy = false;
      resolve(checks);
    });

    req.on('timeout', () => {
      req.destroy();
      checks.server = false;
      checks.healthy = false;
      resolve(checks);
    });
  });
}

function logHealth(checks) {
  try {
    const line = `[${checks.timestamp}] healthy=${checks.healthy} server=${checks.server} uptime=${Math.round(checks.uptime)}s sessions=${checks.sessions || 0}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, 'health.log'), line);
  } catch {}
}

function startHealthChecks(port = 7777, intervalMs = 30000) {
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(async () => {
    const checks = await checkHealth(port);
    logHealth(checks);
    if (!checks.healthy) {
      notify({ message: '⚠️ Relay health check failed', sound: 'error' });
    }
  }, intervalMs);
  return healthInterval;
}

function stopHealthChecks() {
  if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
  if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
}

function cleanupOldFiles(maxAgeDays = 30) {
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let cleaned = 0;

  // Clean old logs
  try {
    const logFiles = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
    for (const file of logFiles) {
      const filePath = path.join(LOGS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
  } catch {}

  return { cleaned };
}

function getSessionsDiskUsage() {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      totalSize += fs.statSync(path.join(SESSIONS_DIR, f)).size;
    }
  } catch {}
  return { bytes: totalSize, mb: Math.round(totalSize / 1024 / 1024 * 100) / 100 };
}

function getFullStatus(port = 7777) {
  return checkHealth(port).then(health => ({
    ...health,
    disk: getSessionsDiskUsage(),
    uptimeMs: Date.now() - startTime,
    pid: process.pid,
    memory: process.memoryUsage()
  }));
}

module.exports = { checkHealth, logHealth, startHealthChecks, stopHealthChecks, cleanupOldFiles, getSessionsDiskUsage, getFullStatus };
