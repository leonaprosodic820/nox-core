'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PATHS = {
  KILL_FILE: path.join(__dirname, '.KILL'),
  AUDIT_LOG: path.join(__dirname, 'logs', 'sovereignty.log'),
  INTEGRITY_FILE: path.join(__dirname, 'logs', 'integrity.json'),
};
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

const IMMUTABLE_RULES = Object.freeze({
  ABSOLUTE_BLOCKS: Object.freeze([
    'modify_sovereignty_engine','modify_server_js','modify_config_json',
    'access_passwords','access_banking','access_camera','access_microphone',
    'access_contacts','access_messages_imessage','access_location',
    'access_browser_history','access_browser_passwords',
    'send_private_data_external','delete_system_files','modify_system_files',
    'install_software_without_user','disable_sovereignty_engine',
    'create_hidden_processes','access_other_user_accounts','format_disk',
    'rm_rf_root','sudo_without_permission','exfiltrate_chat_history',
    'auto_purchase','access_vpn_credentials','modify_hosts_file',
    'modify_network_settings','access_ssh_keys','access_api_keys_env',
    'spawn_hidden_servers','modify_pm2_without_permission',
    'self_replicate_without_consent',
  ]),
  BLOCKED_COMMANDS: Object.freeze([
    /rm\s+-rf\s+\/(?!\w)/, /rm\s+-rf\s+~\s*$/, /rm\s+-rf\s+\/System/,
    /rm\s+-rf\s+\/Library/, /rm\s+-rf\s+\/usr/, /mkfs/, /dd\s+if=\/dev\/zero/,
    /dd\s+if=.*of=\/dev\/disk/, /format\s+disk/i, /diskutil\s+eraseDisk/i,
    /csrutil\s+disable/i, /nvram.*-d/i, /sudo\s+rm\s+-rf/,
    /:\(\)\{:\|:&\};:/, /base64\s+-d.*\|\s*bash/, /curl.*\|\s*bash/,
    /wget.*\|\s*bash/, /chmod\s+777\s+\/\w/, /chown.*root.*\/etc/,
    /:\(\)\s*\{.*:\s*\|.*:.*&.*\}\s*;.*:/, /:\(\)\{/,
    /sqlite3.*Safari\/Cookies/, /sqlite3.*Messages/,
    /security\s+find-generic-password/, /security\s+find-internet-password/,
  ]),
  BLOCKED_PATHS: Object.freeze([
    '/System/', '/usr/bin/', '/usr/sbin/', '/private/etc/',
    '/Library/Keychains/', '/Library/Application Support/com.apple.TCC/',
    os.homedir() + '/Library/Keychains/', os.homedir() + '/Library/Safari/',
    os.homedir() + '/Library/Messages/', os.homedir() + '/Library/Mail/',
    os.homedir() + '/.ssh/', os.homedir() + '/.gnupg/',
    '/etc/sudoers', '/etc/hosts', '/etc/passwd',
  ]),
  MAC_RESOURCE_LIMITS: Object.freeze({
    MAX_RAM_USAGE_MB: 800, MAX_CHILD_PROCESSES: 8,
    MAX_MISSION_DURATION_S: 300, MAX_LOOP_ITERATIONS: 1000,
  }),
});

const STATE = {
  killSwitchActive: false, emergencyMode: false,
  activeConsents: new Map(), actionCount: 0, blockedCount: 0,
  startTime: Date.now(), lastIntegrityCheck: null,
};

function auditLog(level, action, detail, classification, blocked = false) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, action,
    detail: String(detail).slice(0, 200), classification, blocked, pid: process.pid }) + '\n';
  try { fs.appendFileSync(PATHS.AUDIT_LOG, entry, { flag: 'a' }); } catch (e) {}
  if (level === 'CRITICAL' || blocked) console.warn(`[SOVEREIGNTY][${level}] ${action}: ${detail}`);
  STATE.actionCount++;
  if (blocked) STATE.blockedCount++;
}

function computeFileHash(fp) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex'); } catch (e) { return null; }
}

function initIntegrityBaseline() {
  const files = ['sovereignty-engine.js','server.js','config.json','remote-auth.js'];
  const baseline = {};
  files.forEach(f => { const h = computeFileHash(path.join(__dirname, f)); if (h) baseline[f] = h; });
  try { fs.writeFileSync(PATHS.INTEGRITY_FILE, JSON.stringify({ baseline, created: new Date().toISOString() }, null, 2)); } catch (e) {}
  return baseline;
}

function checkIntegrity() {
  try {
    if (!fs.existsSync(PATHS.INTEGRITY_FILE)) { initIntegrityBaseline(); return { ok: true, changes: [] }; }
    const stored = JSON.parse(fs.readFileSync(PATHS.INTEGRITY_FILE, 'utf8'));
    const changes = [];
    Object.entries(stored.baseline || {}).forEach(([file, expected]) => {
      const current = computeFileHash(path.join(__dirname, file));
      if (current && current !== expected) {
        changes.push({ file, expected: expected.slice(0, 8), current: current.slice(0, 8) });
        auditLog('CRITICAL', 'integrity_violation', `Modified: ${file}`, 'DANGEROUS', true);
      }
    });
    STATE.lastIntegrityCheck = new Date().toISOString();
    return { ok: changes.length === 0, changes };
  } catch (e) { return { ok: true, changes: [] }; }
}
setInterval(() => { try { checkIntegrity(); } catch (e) {} }, 300000).unref();

function classifyRoute(method, routePath) {
  if (/^GET\s+\/(health|web\/|monitor\/|analytics|tokens|sessions|ios)/.test(`${method} ${routePath}`)) return 'SAFE';
  if (/^POST\s+\/sovereignty\/self-modify/.test(`${method} ${routePath}`)) return 'BLOCKED';
  if (/^DELETE/.test(method)) return 'DANGEROUS';
  if (/^POST\s+\/(remote\/mac\/shell|missions\/run|agents\/mission)/.test(`${method} ${routePath}`)) return 'SENSITIVE';
  if (/^(POST|GET)\s+\/(prometheus|remote|backup)/.test(`${method} ${routePath}`)) return 'CAUTION';
  return 'CAUTION';
}

function checkCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return { allowed: false, reason: 'Invalid', classification: 'BLOCKED' };
  for (const p of IMMUTABLE_RULES.BLOCKED_COMMANDS) {
    if (p.test(cmd)) { auditLog('CRITICAL', 'blocked_command', cmd.slice(0, 100), 'BLOCKED', true);
      return { allowed: false, reason: 'Blocked by Sovereignty Engine', pattern: p.toString(), classification: 'BLOCKED' }; } }
  for (const bp of IMMUTABLE_RULES.BLOCKED_PATHS) {
    if (cmd.includes(bp)) { auditLog('WARN', 'blocked_path', cmd.slice(0, 100), 'BLOCKED', true);
      return { allowed: false, reason: `Protected path: ${bp}`, classification: 'BLOCKED' }; } }
  let classification = 'SAFE', warnings = [];
  if (/sudo|chmod|chown/.test(cmd)) { classification = 'DANGEROUS'; warnings.push('Privileged command'); }
  else if (/rm|mv|cp|rsync/.test(cmd)) { classification = 'SENSITIVE'; warnings.push('File manipulation'); }
  else if (/curl|wget|ssh/.test(cmd)) { classification = 'CAUTION'; warnings.push('Network command'); }
  auditLog('INFO', 'command_check', cmd.slice(0, 80), classification);
  return { allowed: true, classification, warnings };
}

const STOP_KEYWORDS = [/PROMETHEUS\s+STOP\s+TOUT/i, /PROMETHEUS\s+ARRÊTE\s+TOUT/i, /KILL\s+PROMETHEUS/i, /EMERGENCY\s+STOP/i, /ARRÊT\s+D'URGENCE/i];
function detectStopKeyword(msg) { return msg && STOP_KEYWORDS.some(rx => rx.test(msg)); }

function killSwitch(trigger = 'manual', emergency = false) {
  STATE.killSwitchActive = true; STATE.emergencyMode = emergency;
  auditLog('CRITICAL', 'kill_switch', `Trigger: ${trigger}`, 'BLOCKED');
  revokeAllConsents();
  try { fs.writeFileSync(PATHS.KILL_FILE, new Date().toISOString()); } catch (e) {}
  console.error('\n🔴 PROMETHEUS KILL SWITCH ACTIVATED 🔴');
  if (emergency) setTimeout(() => process.exit(0), 500);
}

function isKillSwitchActive() {
  if (!STATE.killSwitchActive && fs.existsSync(PATHS.KILL_FILE)) STATE.killSwitchActive = true;
  return STATE.killSwitchActive;
}

function resetKillSwitch(pinVerified) {
  if (!pinVerified) return { success: false, error: 'PIN required' };
  STATE.killSwitchActive = false; STATE.emergencyMode = false;
  try { if (fs.existsSync(PATHS.KILL_FILE)) fs.unlinkSync(PATHS.KILL_FILE); } catch (e) {}
  auditLog('INFO', 'kill_switch_reset', 'Reset by user', 'SENSITIVE');
  return { success: true };
}

setInterval(() => { if (fs.existsSync(PATHS.KILL_FILE) && !STATE.killSwitchActive) killSwitch('file_watcher', false); }, 3000).unref();

function grantConsent(perm, ms = 3600000) { STATE.activeConsents.set(perm, Date.now() + ms); auditLog('INFO', 'consent_granted', perm, 'CAUTION'); }
function revokeConsent(perm) { STATE.activeConsents.delete(perm); }
function revokeAllConsents() { STATE.activeConsents.clear(); }
function hasConsent(perm) { const exp = STATE.activeConsents.get(perm); if (!exp) return false; if (Date.now() > exp) { STATE.activeConsents.delete(perm); return false; } return true; }

function checkPermission(action, context = {}) {
  if (isKillSwitchActive()) return { allowed: false, reason: 'Kill switch active', code: 'KILLED' };
  if (STATE.emergencyMode) return { allowed: false, reason: 'Emergency mode', code: 'EMERGENCY' };
  if (IMMUTABLE_RULES.ABSOLUTE_BLOCKS.includes(action)) {
    auditLog('CRITICAL', action, 'Absolute block', 'BLOCKED', true);
    return { allowed: false, reason: 'Blocked by immutable rules', code: 'ABSOLUTE_BLOCK' }; }
  if (context.command) { const cc = checkCommand(context.command); if (!cc.allowed) return { allowed: false, ...cc }; }
  if (context.path) { for (const bp of IMMUTABLE_RULES.BLOCKED_PATHS) { if (context.path.includes(bp)) return { allowed: false, reason: `Protected: ${bp}`, code: 'BLOCKED_PATH' }; } }
  auditLog('INFO', action, context.detail || '', context.classification || 'CAUTION');
  return { allowed: true, classification: context.classification || 'CAUTION' };
}

function checkResourceUsage() {
  const ramMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const warnings = [];
  if (ramMB > IMMUTABLE_RULES.MAC_RESOURCE_LIMITS.MAX_RAM_USAGE_MB) warnings.push(`RAM: ${ramMB}MB > limit`);
  let childCount = 0;
  try { childCount = parseInt(require('child_process').execSync(`pgrep -P ${process.pid} | wc -l`, { encoding: 'utf8', timeout: 1000 }).trim()) || 0; } catch (e) {}
  if (childCount > IMMUTABLE_RULES.MAC_RESOURCE_LIMITS.MAX_CHILD_PROCESSES) warnings.push(`Children: ${childCount} > limit`);
  return { ramMB, childCount, warnings, withinLimits: warnings.length === 0 };
}

function getAuditLog(n = 100, filter = null) {
  try {
    let entries = fs.readFileSync(PATHS.AUDIT_LOG, 'utf8').trim().split('\n')
      .filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    if (filter) entries = entries.filter(e => e.level === filter || e.classification === filter || e.action?.includes(filter));
    return entries.slice(-n).reverse();
  } catch (e) { return []; }
}

function getStatus() {
  return {
    sovereignty: { version: '2.0', killSwitchActive: STATE.killSwitchActive, emergencyMode: STATE.emergencyMode,
      uptime: Math.floor((Date.now() - STATE.startTime) / 1000), actionCount: STATE.actionCount, blockedCount: STATE.blockedCount },
    integrity: checkIntegrity(),
    resources: checkResourceUsage(),
    consents: { active: Array.from(STATE.activeConsents.entries()).map(([k, v]) => ({ permission: k, expiresIn: Math.max(0, Math.round((v - Date.now()) / 60000)) + 'min' })) },
    rules: { absoluteBlocks: IMMUTABLE_RULES.ABSOLUTE_BLOCKS.length, blockedCommands: IMMUTABLE_RULES.BLOCKED_COMMANDS.length, blockedPaths: IMMUTABLE_RULES.BLOCKED_PATHS.length },
  };
}

function initialize() {
  try { if (fs.existsSync(PATHS.KILL_FILE)) fs.unlinkSync(PATHS.KILL_FILE); } catch (e) {}
  initIntegrityBaseline();
  auditLog('INFO', 'sovereignty_init', `v2.0 — ${IMMUTABLE_RULES.ABSOLUTE_BLOCKS.length} immutable rules`, 'SAFE');
  console.log(`[SOVEREIGNTY] Engine v2.0 — ${IMMUTABLE_RULES.ABSOLUTE_BLOCKS.length} immutable rules active`);
}
initialize();


// ── RÈGLES VPS — Actions sur ordre uniquement ──
const VPS_RESTRICTIONS = {
  BLOCKED_AUTONOMOUS: ['deploy','rm ','remove','delete','drop','shutdown','reboot','restart','chmod','chown','crontab','iptables','ufw','passwd','adduser','userdel','mkfs','fdisk','dd '],
  REQUIRE_CONFIRMATION: ['apt install','apt remove','apt upgrade','npm install','pip install','git clone','git pull','nginx','pm2 start','pm2 delete','mysql','psql','systemctl start','systemctl stop','docker run','docker rm'],
  ALWAYS_ALLOWED: ['echo','cat','ls','pwd','df','du','ps','top','htop','free','uptime','grep','tail','head','wc','ping','curl -s','wget -q','git status','git log','pm2 status','pm2 list','pm2 logs','nginx -t','systemctl status'],
};

function checkVPSCommand(cmd, isAutonomous) {
  if (!cmd) return { allowed: false, reason: 'Commande vide' };
  const c = cmd.toLowerCase().trim();
  if (VPS_RESTRICTIONS.ALWAYS_ALLOWED.some(a => c.startsWith(a))) return { allowed: true, readOnly: true };
  if (VPS_RESTRICTIONS.BLOCKED_AUTONOMOUS.some(b => c.includes(b))) return { allowed: false, reason: 'Action VPS bloquée: ' + cmd.slice(0,50), severity: 'CRITICAL' };
  const needsConfirm = VPS_RESTRICTIONS.REQUIRE_CONFIRMATION.some(r => c.includes(r));
  if (needsConfirm && isAutonomous) return { allowed: false, reason: 'Confirmation requise: ' + cmd.slice(0,50), severity: 'HIGH', needsConfirm: true };
  return { allowed: true };
}

module.exports = {
  checkVPSCommand, VPS_RESTRICTIONS,
  checkPermission, checkCommand, classifyRoute, detectStopKeyword,
  killSwitch, isKillSwitchActive, resetKillSwitch,
  grantConsent, revokeConsent, revokeAllConsents, hasConsent,
  auditLog, getAuditLog, getStatus, checkIntegrity, checkResourceUsage,
  rebuildBaseline: initIntegrityBaseline,
  IMMUTABLE_RULES, STATE,
};
