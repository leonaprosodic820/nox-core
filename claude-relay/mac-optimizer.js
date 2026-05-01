'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const HOME = os.homedir();

function run(cmd, opts = {}) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: opts.timeout || 10000, stdio: ['pipe','pipe','ignore'] }).trim(); }
  catch (e) { return opts.fallback || ''; }
}

function parseSize(s) { if (!s) return 0; const n = parseFloat(s); if (s.includes('G')) return n; if (s.includes('M')) return n/1024; return n/1048576; }

async function analyzeSystem() {
  const a = { timestamp: new Date().toISOString(), hardware: {}, storage: {}, memory: {}, cpu: {}, processes: {}, startup: {}, issues: [], recommendations: [], potentialSavings: 0 };

  a.hardware = {
    model: run("system_profiler SPHardwareDataType | grep 'Model Name' | awk -F: '{print $2}'").trim(),
    chip: run("system_profiler SPHardwareDataType | grep 'Chip\\|Processor' | head -1 | awk -F: '{print $2}'").trim(),
    ram: run("system_profiler SPHardwareDataType | grep Memory | awk -F: '{print $2}'").trim(),
    macOS: run('sw_vers -productVersion'), uptime: run('uptime | cut -d, -f1'),
  };

  const dp = run('df -H / | tail -1').split(/\s+/);
  const cacheSize = run('du -sh ~/Library/Caches 2>/dev/null | cut -f1');
  const trashSize = run('du -sh ~/.Trash 2>/dev/null | cut -f1');
  const npmSize = run('du -sh ~/.npm 2>/dev/null | cut -f1');
  const brewSize = run('du -sh $(brew --cache 2>/dev/null) 2>/dev/null | cut -f1');

  a.storage = { total: dp[1]||'?', used: dp[2]||'?', available: dp[3]||'?', usedPct: dp[4]||'?',
    caches: { userCache: cacheSize, trash: trashSize, npmCache: npmSize, brewCache: brewSize },
    largeFiles: run(`find ${HOME} -size +500M -not -path "*/.Trash/*" -not -path "*/Library/Containers/*" 2>/dev/null | head -10`).split('\n').filter(Boolean),
  };

  const rf = os.freemem(), rt = os.totalmem();
  a.memory = { total_gb: (rt/1e9).toFixed(1), free_gb: (rf/1e9).toFixed(1), used_pct: Math.round((1-rf/rt)*100) };
  a.cpu = { load: run('uptime | awk -F"load averages:" \'{print $2}\'').trim(),
    topProcs: run('ps -Ao pid,pcpu,pmem,comm -r | head -6 | tail -5').split('\n').filter(Boolean) };
  a.processes = {
    highCPU: run('ps -Ao pid,pcpu,comm -r | awk \'$2>5\' | head -5').split('\n').filter(Boolean),
    highRAM: run('ps -Ao pid,pmem,comm -r | awk \'$2>3\' | head -5').split('\n').filter(Boolean),
  };
  a.startup = { userAgents: run(`ls ${HOME}/Library/LaunchAgents 2>/dev/null`).split('\n').filter(Boolean) };
  a.startup.count = a.startup.userAgents.length;

  let savings = 0;
  const cGB = parseSize(cacheSize), tGB = parseSize(trashSize), nGB = parseSize(npmSize), bGB = parseSize(brewSize);
  if (cGB > 1) { a.issues.push({ type: 'CAUTION', title: 'Caches volumineux', detail: cacheSize, action: 'clean_cache', savingGB: cGB }); savings += cGB; }
  if (tGB > 0.1) { a.issues.push({ type: 'SAFE', title: 'Corbeille', detail: trashSize, action: 'empty_trash', savingGB: tGB }); savings += tGB; }
  if (nGB > 0.5) { a.issues.push({ type: 'SAFE', title: 'Cache npm', detail: npmSize, action: 'clean_npm', savingGB: nGB }); savings += nGB; }
  if (bGB > 0.5) { a.issues.push({ type: 'SAFE', title: 'Cache Homebrew', detail: brewSize, action: 'clean_brew', savingGB: bGB }); savings += bGB; }
  if (a.memory.used_pct > 85) a.issues.push({ type: 'WARN', title: 'RAM élevée', detail: a.memory.used_pct+'%', action: 'optimize_memory' });
  if (parseInt(a.storage.usedPct) > 85) a.issues.push({ type: 'CRITICAL', title: 'Disque presque plein', detail: a.storage.usedPct, action: 'free_disk_space' });
  a.potentialSavings = savings.toFixed(1)+'GB';
  a.recommendations = a.issues.map(i => ({ priority: i.type, action: i.title, saving: i.savingGB ? i.savingGB.toFixed(1)+'GB' : null }));
  return a;
}

async function cleanUserCache(opts={}) {
  const preview = run('du -sh ~/Library/Caches/*/ 2>/dev/null | sort -rh | head -10');
  if (opts.dryRun) return { dryRun: true, preview, action: 'clean_cache' };
  const before = run('du -sh ~/Library/Caches 2>/dev/null | cut -f1');
  run('find ~/Library/Caches -mindepth 1 -maxdepth 2 -type f -atime +7 -delete 2>/dev/null', { timeout: 30000 });
  const after = run('du -sh ~/Library/Caches 2>/dev/null | cut -f1');
  return { success: true, before, after };
}

async function emptyTrash(opts={}) {
  const size = run('du -sh ~/.Trash 2>/dev/null | cut -f1');
  if (opts.dryRun) return { dryRun: true, preview: 'Corbeille: '+size, files: run('ls ~/.Trash 2>/dev/null').split('\n').slice(0,10) };
  run('rm -rf ~/.Trash/* 2>/dev/null');
  return { success: true, freed: size };
}

async function cleanNpmCache(opts={}) {
  const size = run('du -sh ~/.npm 2>/dev/null | cut -f1');
  if (opts.dryRun) return { dryRun: true, size };
  run('npm cache clean --force 2>/dev/null');
  return { success: true, freed: size };
}

async function cleanBrewCache(opts={}) {
  const size = run('du -sh $(brew --cache 2>/dev/null) 2>/dev/null | cut -f1');
  if (opts.dryRun) return { dryRun: true, size };
  run('brew cleanup --prune=all 2>/dev/null', { timeout: 30000 });
  return { success: true, freed: size };
}

async function cleanPM2Logs(opts={}) {
  const size = run('du -sh ~/.pm2/logs 2>/dev/null | cut -f1');
  if (opts.dryRun) return { dryRun: true, size };
  run('pm2 flush 2>/dev/null');
  return { success: true, freed: size };
}

async function cleanDockerData(opts={}) {
  if (!run('which docker 2>/dev/null')) return { success: false, reason: 'Docker non installé' };
  if (opts.dryRun) return { dryRun: true };
  run('docker system prune -f 2>/dev/null', { timeout: 30000 });
  return { success: true };
}

async function optimizeMemory(opts={}) {
  if (opts.dryRun) return { dryRun: true, highMem: run('ps -Ao pid,pmem,comm -r | awk "$2>3" | head -5') };
  run('sudo purge 2>/dev/null');
  return { success: true, action: 'Caches mémoire purgés' };
}

async function findLargeFiles(minGB=0.5) {
  const mb = Math.round(minGB*1024);
  return run(`find ${HOME} -size +${mb}M -not -path "*/.Trash/*" -not -path "*/Library/Containers/*" -not -path "*/.git/*" 2>/dev/null | head -20`)
    .split('\n').filter(Boolean).map(f => ({ path: f, size: run(`du -sh "${f}" 2>/dev/null | cut -f1`) }));
}

async function analyzeStartupItems() {
  return run(`ls ${HOME}/Library/LaunchAgents 2>/dev/null`).split('\n').filter(Boolean)
    .map(a => ({ name: a, path: `${HOME}/Library/LaunchAgents/${a}` }));
}

async function optimizePrometheus() {
  run('find ~/claude-relay/logs -name "*.log" -mtime +7 -delete 2>/dev/null');
  const size = run('du -sh ~/claude-relay 2>/dev/null | cut -f1');
  return { results: ['Old logs cleaned'], prometheusSize: size };
}

async function generateOptimizationReport() {
  const analysis = await analyzeSystem();
  try {
    const bridge = require('./claude-api-bridge');
    const r = await bridge.callFast(`Expert macOS. État:\n${JSON.stringify({ storage: analysis.storage, memory: analysis.memory, issues: analysis.issues }, null, 2).slice(0,2000)}\n\nRapport concis: état (🟢/🟡/🔴), top 5 actions, économies.`, { maxTokens: 400 });
    analysis.aiReport = typeof r === 'string' ? r : r.content?.[0]?.text || '';
  } catch (e) { analysis.aiReport = 'IA indisponible'; }
  return analysis;
}

module.exports = { analyzeSystem, generateOptimizationReport, cleanUserCache, emptyTrash, cleanNpmCache, cleanBrewCache, cleanPM2Logs, cleanDockerData, optimizeMemory, findLargeFiles, analyzeStartupItems, optimizePrometheus };
