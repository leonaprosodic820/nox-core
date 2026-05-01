'use strict';
const { execSync } = require('child_process');
const os = require('os');

const cache = new Map();
const TTL = { apps: 4000, volume: 2000, clipboard: 1000, wifi: 10000, battery: 15000, cpu: 3000, disk: 30000 };

function cached(key, ttl, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.val;
  const val = fn();
  cache.set(key, { val, ts: Date.now() });
  return val;
}

function run(cmd, fb = '--', ms = 3000) {
  try { return execSync(cmd, { timeout: ms, encoding: 'utf-8' }).trim() || fb; } catch { return fb; }
}

const FAST_CMDS = {
  apps: () => cached('apps', TTL.apps, () => run("ps -axco comm= | sort -u | grep -v '^$' | head -20 | tr '\n' ','", '', 2000).replace(/,$/, '')),
  clipboard: () => cached('clipboard', TTL.clipboard, () => run('pbpaste 2>/dev/null || true', '', 500)),
  volume: () => cached('volume', TTL.volume, () => parseInt(run("osascript -e 'output volume of (get volume settings)'", '50', 1500)) || 50),
  battery: () => cached('battery', TTL.battery, () => {
    const raw = run("pmset -g batt 2>/dev/null | grep -Eo '[0-9]+%' | head -1", 'N/A', 2000);
    const chg = run("pmset -g batt 2>/dev/null | grep -Eo 'charging|AC' | head -1", '', 1000);
    return raw + (chg ? ' ⚡' : '');
  }),
  wifi: () => cached('wifi', TTL.wifi, () => run("networksetup -getairportnetwork en0 2>/dev/null | sed 's/Current Wi-Fi Network: //'", '--', 2000)),
  cpu: () => cached('cpu', TTL.cpu, () => {
    const ps = run("ps -A -o %cpu= | awk '{s+=$1} END {printf \"%.1f%%\",s}'", '', 2000);
    return ps && ps !== '--' ? ps : run("top -l 1 -n 0 2>/dev/null | grep 'CPU usage' | awk '{print $3}'", '--', 4000);
  }),
  ram: () => Math.round((1 - os.freemem() / os.totalmem()) * 100) + '%',
  disk: () => cached('disk', TTL.disk, () => run("df -h / 2>/dev/null | tail -1 | awk '{print $5}'", '--', 2000)),
};

async function getSystemStatus() {
  const cpu = FAST_CMDS.cpu();
  const ram = FAST_CMDS.ram();
  const battery = FAST_CMDS.battery();
  const disk = FAST_CMDS.disk();
  const wifi = FAST_CMDS.wifi();
  const apps = FAST_CMDS.apps();
  const volume = FAST_CMDS.volume();
  const claudeRunning = run("pgrep -f claude 2>/dev/null | wc -l", '0', 1000).trim() !== '0';
  return { cpu, ram, battery, disk, wifi, apps, volume, claudeRunning, uptime: Math.floor(process.uptime()) };
}

function getCacheStats() {
  return { size: cache.size, keys: Array.from(cache.keys()) };
}

function invalidateAll() { cache.clear(); }

module.exports = { FAST_CMDS, getSystemStatus, getCacheStats, invalidateAll, run, cached };
