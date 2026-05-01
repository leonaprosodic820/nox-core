'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const STORAGE_PATH = path.join(__dirname, 'knowledge', 'sensory-patterns.json');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let intervalHandle = null;
let config = { intervalMs: 60000 };
let observations = [];

function ensureStorage() {
  try {
    const dir = path.dirname(STORAGE_PATH);
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) { /* ignore */ }
}

function loadObservations() {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    const data = JSON.parse(raw);
    observations = Array.isArray(data.observations) ? data.observations : [];
    pruneOld();
  } catch (e) {
    observations = [];
  }
}

function saveObservations() {
  try {
    ensureStorage();
    fs.writeFileSync(STORAGE_PATH, JSON.stringify({ observations, lastSaved: new Date().toISOString() }, null, 2));
  } catch (e) { /* ignore */ }
}

function pruneOld() {
  const cutoff = Date.now() - MAX_AGE_MS;
  observations = observations.filter(o => new Date(o.timestamp).getTime() > cutoff);
}

function observe() {
  try {
    // Get app names (metadata only)
    let apps = [];
    try {
      const raw = execSync('ps -axco comm=', { timeout: 5000, encoding: 'utf8' });
      apps = [...new Set(raw.split('\n').filter(Boolean).map(s => s.trim()))];
    } catch (e) { apps = []; }

    // Get CPU usage from ps
    let cpuPercent = 0;
    try {
      const raw = execSync("ps -A -o %cpu= | awk '{s+=$1} END {print s}'", { timeout: 5000, encoding: 'utf8' });
      cpuPercent = parseFloat(raw.trim()) || 0;
    } catch (e) { cpuPercent = 0; }

    // Get RAM via os module
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

    const obs = {
      timestamp: new Date().toISOString(),
      apps: apps.slice(0, 100), // cap list
      cpu: Math.round(cpuPercent * 10) / 10,
      ram: { totalGB: Math.round(totalMem / (1024 ** 3) * 10) / 10, usedPercent },
      uptime: os.uptime()
    };

    observations.push(obs);
    pruneOld();
    saveObservations();

    return obs;
  } catch (err) {
    return { error: err.message, timestamp: new Date().toISOString() };
  }
}

function getPredictions() {
  if (observations.length < 5) {
    return { status: 'insufficient_data', minRequired: 5, current: observations.length };
  }

  const recent = observations.slice(-30);
  const avgCpu = recent.reduce((s, o) => s + (o.cpu || 0), 0) / recent.length;
  const avgRam = recent.reduce((s, o) => s + (o.ram?.usedPercent || 0), 0) / recent.length;

  // Trend detection
  const half = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, half);
  const secondHalf = recent.slice(half);
  const cpuTrend1 = firstHalf.reduce((s, o) => s + (o.cpu || 0), 0) / firstHalf.length;
  const cpuTrend2 = secondHalf.reduce((s, o) => s + (o.cpu || 0), 0) / secondHalf.length;

  return {
    avgCpu: Math.round(avgCpu * 10) / 10,
    avgRam: Math.round(avgRam),
    cpuTrend: cpuTrend2 > cpuTrend1 + 5 ? 'rising' : cpuTrend2 < cpuTrend1 - 5 ? 'falling' : 'stable',
    observationCount: observations.length,
    prediction: avgCpu > 70 ? 'high_load_expected' : 'normal_load_expected'
  };
}

function detectAnomalies() {
  const anomalies = [];
  const recent = observations.slice(-5);

  if (recent.length < 2) return { anomalies: [], status: 'insufficient_data' };

  // CPU > 90% for last 5 observations
  const allHighCpu = recent.every(o => (o.cpu || 0) > 90);
  if (allHighCpu) {
    anomalies.push({ type: 'CPU_SUSTAINED_HIGH', detail: 'CPU > 90% for 5+ consecutive observations', severity: 'critical' });
  }

  // RAM > 95%
  const highRam = recent.filter(o => (o.ram?.usedPercent || 0) > 95);
  if (highRam.length > 0) {
    anomalies.push({ type: 'RAM_CRITICAL', detail: `RAM > 95% in ${highRam.length} recent observation(s)`, severity: 'critical' });
  }

  return { anomalies, checked: new Date().toISOString(), observationsChecked: recent.length };
}

function getPatterns() {
  if (observations.length < 10) return { status: 'insufficient_data', current: observations.length };

  // Find most common apps
  const appCount = {};
  for (const obs of observations) {
    for (const app of (obs.apps || [])) {
      appCount[app] = (appCount[app] || 0) + 1;
    }
  }
  const topApps = Object.entries(appCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, frequency: count }));

  return {
    totalObservations: observations.length,
    topApps,
    oldestObservation: observations[0]?.timestamp || null,
    newestObservation: observations[observations.length - 1]?.timestamp || null
  };
}

function start(intervalMs) {
  if (intervalHandle) return { status: 'already_running' };
  config.intervalMs = intervalMs || config.intervalMs;
  loadObservations();
  observe(); // initial observation
  intervalHandle = setInterval(observe, config.intervalMs);
  return { status: 'started', intervalMs: config.intervalMs };
}

function stop() {
  if (!intervalHandle) return { status: 'not_running' };
  clearInterval(intervalHandle);
  intervalHandle = null;
  return { status: 'stopped' };
}

function getStatus() {
  return {
    running: intervalHandle !== null,
    intervalMs: config.intervalMs,
    observationCount: observations.length,
    lastObservation: observations.length > 0 ? observations[observations.length - 1].timestamp : null
  };
}

function updateConfig(newConfig) {
  if (newConfig.intervalMs && typeof newConfig.intervalMs === 'number' && newConfig.intervalMs >= 5000) {
    config.intervalMs = newConfig.intervalMs;
    if (intervalHandle) {
      stop();
      start(config.intervalMs);
    }
  }
  return { ...config };
}

// Load on require
loadObservations();

module.exports = { observe, getPredictions, detectAnomalies, getPatterns, start, stop, getStatus, updateConfig };
