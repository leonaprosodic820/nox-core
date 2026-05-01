'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const RELAY_DIR = __dirname;
const BACKUP_ROOT = (() => {
  const icloud = path.join(require('os').homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/PROMETHEUS_Backup');
  try { fs.mkdirSync(icloud, { recursive: true }); return icloud; } catch (e) {}
  const local = path.join(require('os').homedir(), 'Documents/PROMETHEUS_Backup');
  fs.mkdirSync(local, { recursive: true });
  return local;
})();

const SOURCES = ['sessions', 'chat-history', 'knowledge', 'metrics', 'config.json', 'ecosystem.config.js'];
const RETENTION = 30;

async function createSnapshot() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapDir = path.join(BACKUP_ROOT, `snapshot_${ts}`);
  fs.mkdirSync(snapDir, { recursive: true });

  const manifest = { timestamp: new Date().toISOString(), version: '7.3', files: [], totalSize: 0 };
  let totalBytes = 0;

  for (const src of SOURCES) {
    const srcPath = path.join(RELAY_DIR, src);
    if (!fs.existsSync(srcPath)) continue;
    try {
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        execSync(`cp -r "${srcPath}" "${path.join(snapDir, src)}"`, { stdio: 'ignore' });
        const size = parseInt(execSync(`du -sk "${path.join(snapDir, src)}"`, { encoding: 'utf8' }).split('\t')[0]) * 1024;
        totalBytes += size;
        manifest.files.push({ name: src, type: 'directory', size });
      } else {
        fs.copyFileSync(srcPath, path.join(snapDir, src));
        totalBytes += stat.size;
        manifest.files.push({ name: src, type: 'file', size: stat.size });
      }
    } catch (e) { manifest.files.push({ name: src, error: e.message }); }
  }

  manifest.totalSize = totalBytes;
  fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const archive = snapDir + '.tar.gz';
  try {
    execSync(`tar -czf "${archive}" -C "${BACKUP_ROOT}" "snapshot_${ts}"`, { stdio: 'ignore' });
    execSync(`rm -rf "${snapDir}"`, { stdio: 'ignore' });
  } catch (e) { return { success: true, path: snapDir, manifest }; }

  console.log(`[Backup] Snapshot: ${path.basename(archive)} (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
  return { success: true, path: archive, manifest };
}

function cleanup() {
  try {
    const items = fs.readdirSync(BACKUP_ROOT).filter(f => f.startsWith('snapshot_'))
      .map(f => ({ name: f, path: path.join(BACKUP_ROOT, f), mtime: fs.statSync(path.join(BACKUP_ROOT, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    const toDelete = items.slice(RETENTION);
    toDelete.forEach(item => { try { if (fs.statSync(item.path).isDirectory()) execSync(`rm -rf "${item.path}"`, { stdio: 'ignore' }); else fs.unlinkSync(item.path); } catch (e) {} });
    return { kept: Math.min(items.length, RETENTION), deleted: toDelete.length };
  } catch (e) { return { error: e.message }; }
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_ROOT).filter(f => f.startsWith('snapshot_'))
      .map(f => { const p = path.join(BACKUP_ROOT, f); const s = fs.statSync(p); return { name: f, path: p, size: (s.size / 1024 / 1024).toFixed(1) + ' MB', created: s.mtime.toLocaleString('fr-FR'), mtime: s.mtime }; })
      .sort((a, b) => b.mtime - a.mtime).slice(0, 30);
  } catch (e) { return []; }
}

function restoreSnapshot(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) return { success: false, error: 'Non trouvé' };
  try {
    const tmpDir = path.join(BACKUP_ROOT, '_restore_tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    execSync(`tar -xzf "${snapshotPath}" -C "${tmpDir}"`, { stdio: 'ignore' });
    const snapDir = fs.readdirSync(tmpDir).find(f => f.startsWith('snapshot_'));
    if (!snapDir) return { success: false, error: 'Archive invalide' };
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, snapDir, 'manifest.json'), 'utf8'));
    manifest.files.filter(f => !f.error).forEach(f => {
      const src = path.join(tmpDir, snapDir, f.name);
      if (fs.existsSync(src)) execSync(`cp -r "${src}" "${path.join(RELAY_DIR, f.name)}"`, { stdio: 'ignore' });
    });
    execSync(`rm -rf "${tmpDir}"`, { stdio: 'ignore' });
    return { success: true, restored: manifest.timestamp, files: manifest.files.length };
  } catch (e) { return { success: false, error: e.message }; }
}

function startScheduler() {
  const now = new Date();
  const next = new Date(now); next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  console.log(`[Backup] Next: ${next.toLocaleString('fr-FR')}`);
  setTimeout(async () => {
    await createSnapshot(); cleanup();
    setInterval(async () => { await createSnapshot(); cleanup(); }, 86400000).unref();
  }, next - now).unref();
}

module.exports = { createSnapshot, cleanup, listBackups, restoreSnapshot, startScheduler };
