'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
const ICLOUD = path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs');
const PROMETHEUS_ICLOUD = path.join(ICLOUD, 'PROMETHEUS');

const ICLOUD_SYNC_SAFE = ['knowledge/', 'chat-history/', 'metrics/', 'sessions/'];
const ICLOUD_NEVER_SYNC = ['config.json', '.env', 'logs/', 'node_modules/', '.KILL', 'knowledge/chromadb/'];

function isICloudAvailable() { try { return fs.existsSync(ICLOUD) && fs.statSync(ICLOUD).isDirectory(); } catch (e) { return false; } }

function initICloudStructure() {
  if (!isICloudAvailable()) return { success: false, reason: 'iCloud non disponible' };
  ['Backups','KnowledgeBase','AutoDocs','Analytics','Exports','SharedContext'].forEach(d => fs.mkdirSync(path.join(PROMETHEUS_ICLOUD, d), { recursive: true }));
  return { success: true, path: PROMETHEUS_ICLOUD };
}

async function backupToICloud(opts = {}) {
  if (!isICloudAvailable()) return { success: false, reason: 'iCloud non disponible' };
  initICloudStructure();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(PROMETHEUS_ICLOUD, 'Backups', 'backup_' + ts);
  fs.mkdirSync(backupDir, { recursive: true });
  const results = [];
  for (const src of ICLOUD_SYNC_SAFE) {
    const srcFull = path.join(HOME, 'claude-relay', src);
    if (!fs.existsSync(srcFull)) continue;
    try {
      const dest = path.join(backupDir, src.replace(/\//g, '_'));
      execSync(`cp -r "${srcFull}" "${dest}" 2>/dev/null`, { timeout: 30000, stdio: 'ignore' });
      const size = execSync(`du -sh "${dest}" 2>/dev/null | cut -f1`, { encoding: 'utf8', timeout: 5000 }).trim();
      results.push({ src, size, ok: true });
    } catch (e) { results.push({ src, ok: false, error: e.message }); }
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({ timestamp: new Date().toISOString(), files: results, neverSynced: ICLOUD_NEVER_SYNC }, null, 2));
  return { success: true, backupDir: backupDir.replace(HOME, '~'), files: results };
}

async function offloadToICloud(filePath, opts = {}) {
  if (!isICloudAvailable()) return { success: false, reason: 'iCloud non disponible' };
  const blocked = ['/System', '/usr', '.ssh', 'config.json', '.env'];
  if (blocked.some(b => filePath.includes(b))) return { success: false, reason: 'Fichier protégé' };
  const size = execSync(`du -sh "${filePath}" 2>/dev/null | cut -f1`, { encoding: 'utf8', timeout: 3000 }).trim();
  if (opts.dryRun) return { dryRun: true, file: filePath, size };
  initICloudStructure();
  const dest = path.join(PROMETHEUS_ICLOUD, 'Exports', path.basename(filePath));
  execSync(`mv "${filePath}" "${dest}"`, { timeout: 30000 });
  execSync(`ln -s "${dest}" "${filePath}"`, { timeout: 5000 });
  return { success: true, original: filePath, icloud: dest, size };
}

async function syncKnowledgeToICloud() {
  if (!isICloudAvailable()) return { success: false, reason: 'iCloud non disponible' };
  initICloudStructure();
  try {
    execSync(`rsync -av --exclude='chromadb/' --exclude='*.key' "${path.join(HOME, 'claude-relay', 'knowledge')}/" "${path.join(PROMETHEUS_ICLOUD, 'KnowledgeBase')}/" 2>/dev/null`, { timeout: 60000, stdio: 'ignore' });
    const size = execSync(`du -sh "${path.join(PROMETHEUS_ICLOUD, 'KnowledgeBase')}" | cut -f1`, { encoding: 'utf8', timeout: 5000 }).trim();
    return { success: true, size };
  } catch (e) { return { success: false, error: e.message }; }
}

async function syncDocsToICloud() {
  if (!isICloudAvailable()) return { success: false, reason: 'iCloud non disponible' };
  initICloudStructure();
  const src = path.join(HOME, 'claude-relay', 'knowledge', 'autodoc');
  if (!fs.existsSync(src)) return { success: false, reason: 'AutoDocs non créés' };
  try {
    execSync(`rsync -av "${src}/" "${path.join(PROMETHEUS_ICLOUD, 'AutoDocs')}/" 2>/dev/null`, { timeout: 30000, stdio: 'ignore' });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

async function optimizeWithICloud() {
  if (!isICloudAvailable()) return { success: false, reason: 'iCloud non disponible' };
  const results = [];
  results.push(await syncKnowledgeToICloud());
  results.push(await syncDocsToICloud());
  return { success: true, results };
}

function getICloudStats() {
  if (!isICloudAvailable()) return { available: false };
  let prometheusSize = '0';
  try { prometheusSize = execSync(`du -sh "${PROMETHEUS_ICLOUD}" 2>/dev/null | cut -f1`, { encoding: 'utf8', timeout: 5000 }).trim(); } catch (e) {}
  let backups = 0;
  try { backups = fs.existsSync(path.join(PROMETHEUS_ICLOUD, 'Backups')) ? fs.readdirSync(path.join(PROMETHEUS_ICLOUD, 'Backups')).filter(f => f.startsWith('backup_')).length : 0; } catch (e) {}
  return { available: true, icloudPath: PROMETHEUS_ICLOUD.replace(HOME, '~'), prometheusSize, backupsCount: backups,
    structure: fs.existsSync(PROMETHEUS_ICLOUD) ? fs.readdirSync(PROMETHEUS_ICLOUD) : [] };
}

module.exports = { isICloudAvailable, initICloudStructure, backupToICloud, offloadToICloud, syncKnowledgeToICloud, syncDocsToICloud, optimizeWithICloud, getICloudStats, PROMETHEUS_ICLOUD, ICLOUD_NEVER_SYNC };
