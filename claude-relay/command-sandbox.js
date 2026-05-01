'use strict';
/**
 * PROMETHEUS Command Sandbox v9.0
 * Simulation de conséquences avant exécution
 * Classification: SAFE / CAUTION / DANGEROUS / BLOCKED
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOG_FILE = path.join(__dirname, 'logs', 'simulations.json');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

let simLog = [];
try { if (fs.existsSync(LOG_FILE)) simLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (e) {}
function saveLog() { try { fs.writeFileSync(LOG_FILE, JSON.stringify(simLog.slice(-200), null, 2)); } catch (e) {} }

// Patterns de commandes par risque
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/,
  /mkfs\s/,
  /dd\s+if=.*of=\/dev/,
  />\s*\/dev\/sd[a-z]/,
  /format\s+c:/i,
  /:(){ :|:& };:/,
  /chmod\s+-R\s+777\s+\//,
  /curl.*\|\s*(?:bash|sh|zsh)/,
  /wget.*\|\s*(?:bash|sh)/,
];

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /rm\s+-r\s+~/,
  /kill\s+-9\s+1\b/,
  /killall/,
  /sudo\s+rm/,
  /sudo\s+chmod/,
  /sudo\s+chown.*\//,
  /pkill\s/,
  /launchctl\s+unload/,
  /networksetup/,
  /systemsetup/,
  /defaults\s+write/,
  /dscl\s/,
  /diskutil\s+erase/,
  /git\s+push\s+--force/,
  /git\s+reset\s+--hard/,
  /drop\s+table|drop\s+database/i,
  /truncate\s+table/i,
];

const CAUTION_PATTERNS = [
  /sudo\s/,
  /pip\s+install/,
  /npm\s+install\s+-g/,
  /brew\s+install/,
  /brew\s+uninstall/,
  /mv\s.*\//,
  /cp\s+-r/,
  /chmod/,
  /chown/,
  /crontab/,
  /launchctl/,
  /pmset/,
  /scutil/,
];

function classify(command) {
  const cmd = command.trim();

  for (const p of BLOCKED_PATTERNS) {
    if (p.test(cmd)) return { level: 'BLOCKED', reason: 'Pattern destructif détecté', pattern: p.toString() };
  }
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(cmd)) return { level: 'DANGEROUS', reason: 'Commande à haut risque', pattern: p.toString() };
  }
  for (const p of CAUTION_PATTERNS) {
    if (p.test(cmd)) return { level: 'CAUTION', reason: 'Commande nécessitant attention', pattern: p.toString() };
  }
  return { level: 'SAFE', reason: 'Commande standard' };
}

// Analyser les fichiers/process affectés
function analyzeImpact(command) {
  const impact = { files: [], processes: [], network: false, system: false, irreversible: false };

  // Fichiers mentionnés
  const filePaths = command.match(/(?:\/[\w./-]+|~\/[\w./-]+)/g) || [];
  filePaths.forEach(f => {
    const resolved = f.replace('~', require('os').homedir());
    const exists = fs.existsSync(resolved);
    const isDir = exists && fs.statSync(resolved).isDirectory();
    impact.files.push({ path: f, exists, isDir, type: exists ? (isDir ? 'directory' : 'file') : 'non-existent' });
  });

  // Processes
  if (/kill|pkill|killall/.test(command)) {
    impact.processes = command.match(/(?:kill|pkill|killall)\s+(?:-\d+\s+)?(\S+)/g) || [];
  }

  // Network
  if (/curl|wget|ssh|scp|rsync|nc\s|nmap|ping|traceroute|networksetup/i.test(command)) impact.network = true;

  // System
  if (/sudo|launchctl|systemsetup|defaults|pmset|scutil|dscl|diskutil/i.test(command)) impact.system = true;

  // Irreversible
  if (/rm\s|unlink|rmdir|drop\s|truncate|format|erase|reset\s+--hard/i.test(command)) impact.irreversible = true;

  return impact;
}

// Dry-run simulation
function dryRun(command) {
  const results = [];
  const cmd = command.trim();

  // rm → ls preview
  if (/^rm\s/.test(cmd)) {
    const target = cmd.replace(/^rm\s+(-\w+\s+)*/, '').trim();
    try {
      const preview = execSync(`ls -la ${target} 2>/dev/null | head -20`, { encoding: 'utf8', timeout: 5000 });
      results.push({ type: 'preview', description: 'Fichiers qui seraient supprimés', output: preview.trim() });
    } catch (e) {
      results.push({ type: 'preview', description: 'Cible non trouvée', output: target });
    }
  }

  // mv → vérifier source et destination
  if (/^mv\s/.test(cmd)) {
    const parts = cmd.split(/\s+/).slice(1);
    const dest = parts.pop();
    results.push({ type: 'check', description: 'Source(s): ' + parts.join(', '), output: 'Destination: ' + dest });
    if (fs.existsSync(dest)) results.push({ type: 'warning', description: 'Destination existe déjà — écrasement possible' });
  }

  // chmod/chown → montrer l'état actuel
  if (/^(?:chmod|chown)\s/.test(cmd)) {
    const target = cmd.split(/\s+/).pop();
    try {
      const current = execSync(`ls -la ${target} 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim();
      results.push({ type: 'current_state', description: 'Permissions actuelles', output: current });
    } catch (e) {}
  }

  // git operations → montrer le status
  if (/^git\s/.test(cmd)) {
    try {
      const status = execSync('git status --short 2>/dev/null', { encoding: 'utf8', timeout: 3000 }).trim();
      results.push({ type: 'git_status', description: 'État git actuel', output: status || 'Clean' });
    } catch (e) {}
  }

  // pip/npm → vérifier si déjà installé
  if (/^(?:pip|npm)\s+install\s/.test(cmd)) {
    const pkg = cmd.match(/install\s+(\S+)/)?.[1];
    if (pkg) results.push({ type: 'info', description: `Package: ${pkg}`, output: 'Installation ajoutera des dépendances' });
  }

  return results;
}

// Simulation complète
async function simulate(command) {
  const start = Date.now();
  const classification = classify(command);
  const impact = analyzeImpact(command);
  const dryRunResults = dryRun(command);

  // Conséquences possibles
  const consequences = [];
  if (classification.level === 'BLOCKED') {
    consequences.push({ probability: 'HIGH', description: 'COMMANDE BLOQUÉE — risque de destruction système', severity: 'critical' });
  }
  if (impact.irreversible) {
    consequences.push({ probability: 'HIGH', description: 'Action irréversible — données perdues définitivement', severity: 'high' });
  }
  if (impact.system) {
    consequences.push({ probability: 'MEDIUM', description: 'Modification système — peut affecter le boot/services', severity: 'high' });
  }
  if (impact.files.filter(f => f.exists).length > 0) {
    consequences.push({ probability: 'HIGH', description: `${impact.files.filter(f => f.exists).length} fichier(s) existant(s) affecté(s)`, severity: 'medium' });
  }
  if (classification.level === 'SAFE') {
    consequences.push({ probability: 'LOW', description: 'Commande standard — risque minimal', severity: 'low' });
  }

  const simulation = {
    command,
    classification,
    impact,
    dryRun: dryRunResults,
    consequences,
    recommendation: classification.level === 'BLOCKED' ? 'NE PAS EXÉCUTER'
      : classification.level === 'DANGEROUS' ? 'Exécuter avec EXTRÊME prudence — vérifier les fichiers affectés'
      : classification.level === 'CAUTION' ? 'Vérifier les conséquences avant exécution'
      : 'Exécution sûre',
    canExecute: classification.level !== 'BLOCKED',
    ts: new Date().toISOString(),
    durationMs: Date.now() - start,
  };

  // Log
  simLog.push({ command: command.slice(0, 200), level: classification.level, ts: simulation.ts });
  if (simLog.length % 5 === 0) saveLog();

  return simulation;
}

// Exécuter avec pré-analyse
async function safeExecute(command) {
  const sim = await simulate(command);

  if (!sim.canExecute) {
    return { executed: false, simulation: sim, error: 'Commande bloquée par la sandbox' };
  }

  if (sim.classification.level === 'DANGEROUS') {
    return { executed: false, simulation: sim, requireConfirmation: true, message: 'Commande dangereuse — confirmation requise' };
  }

  // Exécuter
  try {
    const output = execSync(command, { encoding: 'utf8', timeout: 30000, cwd: require('os').homedir() }).trim();
    return { executed: true, output: output.slice(0, 5000), simulation: sim };
  } catch (e) {
    return { executed: false, error: e.message, simulation: sim };
  }
}

function getLog(limit = 30) { return simLog.slice(-limit).reverse(); }
function getStats() {
  const byLevel = {};
  simLog.forEach(s => { byLevel[s.level] = (byLevel[s.level] || 0) + 1; });
  return { total: simLog.length, byLevel, blocked: byLevel.BLOCKED || 0 };
}

module.exports = { simulate, safeExecute, classify, analyzeImpact, dryRun, getLog, getStats };
