'use strict';
const fs = require('fs');
const path = require('path');

const ALERTS_LOG = path.join(__dirname, 'knowledge', 'alerts-log.json');
const ALERT_STATE = path.join(__dirname, 'knowledge', 'alert-state.json');

const ALERT_RULES = [
  { id: 'vps1_down', name: 'VPS1 inaccessible', interval: 120000, severity: 'CRITICAL',
    check: async () => { try { require('child_process').execSync('ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no vps1 "echo ok" 2>/dev/null', { timeout: 8000 }); return null; } catch(e) { return 'VPS1 (nox-core.tech) est inaccessible'; } } },
  { id: 'vps2_down', name: 'VPS2 inaccessible', interval: 120000, severity: 'CRITICAL',
    check: async () => { try { require('child_process').execSync('ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no vps2 "echo ok" 2>/dev/null', { timeout: 8000 }); return null; } catch(e) { return 'VPS2 (nox-agent-ia) est inaccessible'; } } },
  { id: 'relay_down', name: 'Claude Relay down', interval: 60000, severity: 'CRITICAL',
    check: async () => { try { const http = require('http'); await new Promise((resolve, reject) => { const req = http.get('http://localhost:7777/health', { timeout: 3000 }, res => { res.statusCode === 200 ? resolve() : reject(); }); req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(); }); }); return null; } catch(e) { return 'Claude Relay (localhost:7777) est down'; } } },
  { id: 'disk_critical', name: 'Disque critique', interval: 300000, severity: 'HIGH',
    check: async () => { try { const out = require('child_process').execSync('df -h / | tail -1', { encoding: 'utf8' }); const pct = parseInt(out.match(/(\d+)%/)?.[1] || '0'); if (pct > 90) return 'Disque Mac critique: ' + pct + '% utilisé'; return null; } catch(e) { return null; } } },
  { id: 'ram_critical', name: 'RAM critique', interval: 120000, severity: 'HIGH',
    check: async () => { try { const out = require('child_process').execSync("vm_stat | grep 'Pages free' | awk '{print $3}'", { encoding: 'utf8' }); const freeMB = Math.round(parseInt(out) * 4096 / 1048576); if (freeMB < 200) return 'RAM critique: seulement ' + freeMB + 'MB libre'; return null; } catch(e) { return null; } } },
  { id: 'pm2_services', name: 'Services PM2', interval: 180000, severity: 'HIGH',
    check: async () => { try { const out = require('child_process').execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8' }); const procs = JSON.parse(out); const down = procs.filter(p => ['claude-relay','cloudflared','hermes'].includes(p.name) && p.pm2_env?.status !== 'online').map(p => p.name); if (down.length > 0) return 'Services PM2 down: ' + down.join(', '); return null; } catch(e) { return null; } } },
];

function loadAlertState() { try { return JSON.parse(fs.readFileSync(ALERT_STATE, 'utf8')); } catch(e) { return { lastFired: {}, lastBrief: null }; } }
function saveAlertState(state) { fs.mkdirSync(path.dirname(ALERT_STATE), { recursive: true }); fs.writeFileSync(ALERT_STATE, JSON.stringify(state, null, 2)); }
function logAlert(ruleId, message) { let logs = []; try { logs = JSON.parse(fs.readFileSync(ALERTS_LOG, 'utf8')); } catch(e) {} logs.unshift({ ts: new Date().toISOString(), ruleId, message }); if (logs.length > 200) logs.pop(); fs.mkdirSync(path.dirname(ALERTS_LOG), { recursive: true }); fs.writeFileSync(ALERTS_LOG, JSON.stringify(logs, null, 2)); }

let _alertCallback = null;
const _timers = new Map();

function start(onAlert) {
  _alertCallback = onAlert;
  console.log('[Alerts] Démarrage surveillance —', ALERT_RULES.length, 'règles');
  ALERT_RULES.forEach(rule => {
    const timer = setTimeout(async () => {
      await checkRule(rule);
      _timers.set(rule.id, setInterval(() => checkRule(rule), rule.interval));
    }, 30000 + Math.random() * 10000);
    _timers.set(rule.id + '_init', timer);
  });
}

async function checkRule(rule) {
  try {
    const state = loadAlertState();
    const now = Date.now();
    const lastFired = state.lastFired[rule.id] || 0;
    if (now - lastFired < 1800000) return;
    const result = await Promise.race([rule.check(), new Promise(r => setTimeout(() => r(null), 15000))]);
    if (result) {
      state.lastFired[rule.id] = now;
      saveAlertState(state);
      logAlert(rule.id, result);
      if (_alertCallback) _alertCallback({ ruleId: rule.id, name: rule.name, severity: rule.severity, message: result });
    }
  } catch(e) { console.error('[Alerts]', rule.id, e.message); }
}

function stop() { _timers.forEach(t => { clearTimeout(t); clearInterval(t); }); _timers.clear(); }
function getLog(limit = 20) { try { return JSON.parse(fs.readFileSync(ALERTS_LOG, 'utf8')).slice(0, limit); } catch(e) { return []; } }
async function runCheck(ruleId) { const rule = ALERT_RULES.find(r => r.id === ruleId); if (!rule) return { error: 'Règle non trouvée' }; const result = await rule.check(); return { ruleId, result: result || 'OK' }; }

module.exports = { start, stop, checkRule, runCheck, getLog, ALERT_RULES };
