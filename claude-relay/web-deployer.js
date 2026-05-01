'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SITES_DIR = path.join(__dirname, 'knowledge', 'sites');
fs.mkdirSync(SITES_DIR, { recursive: true });

function getSSHServers() {
  try {
    const cfg = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    const hosts = []; let cur = null;
    cfg.split('\n').forEach(line => {
      const t = line.trim();
      if (t.startsWith('Host ') && !t.includes('*')) { cur = { alias: t.replace('Host ', '').trim() }; hosts.push(cur); }
      else if (cur && t.startsWith('HostName ')) cur.hostname = t.replace('HostName ', '').trim();
      else if (cur && t.startsWith('User ')) cur.user = t.replace('User ', '').trim();
    });
    return hosts;
  } catch (e) { return []; }
}

function run(cmd, opts = {}) {
  try { return { success: true, output: execSync(cmd, { encoding: 'utf8', timeout: opts.timeout || 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { success: false, error: e.stderr?.slice(0, 300) || e.message }; }
}

async function createSite(description, opts = {}) {
  const id = (opts.name || description).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20) + '-' + crypto.randomBytes(3).toString('hex');
  const dir = path.join(SITES_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const ccBridge = require('./claude-code-bridge');
  const result = await ccBridge.runClaudeCode(
    `Crée un site web complet pour: "${description}". Design moderne, responsive, mobile-first. Sauvegarde dans: ${dir}/ (index.html, style.css, script.js si nécessaire). Contenus réalistes, pas de Lorem Ipsum.`,
    { cwd: dir, timeout: 120000 }
  );

  if (!fs.existsSync(path.join(dir, 'index.html'))) return { error: 'index.html non créé', output: result.output.slice(0, 200) };
  return { success: true, projectId: id, localDir: dir, files: fs.readdirSync(dir), output: result.output.slice(0, 500) };
}

async function deploySite(projectId, sshAlias, opts = {}) {
  const sovereignty = require('./sovereignty-engine');
  const check = sovereignty.checkPermission('deploy_vps', { classification: 'SENSITIVE' });
  if (!check.allowed) return { error: check.reason };

  const localDir = path.join(SITES_DIR, projectId);
  if (!fs.existsSync(localDir)) return { error: 'Projet non trouvé' };

  const servers = getSSHServers();
  const server = servers.find(s => s.alias === sshAlias) || servers[0];
  if (!server) return { error: 'Serveur SSH non trouvé' };

  const remoteDir = `/var/www/previews/${projectId}`;
  const mkdir = run(`ssh ${server.alias} "mkdir -p ${remoteDir}"`);
  if (!mkdir.success) return { error: 'SSH mkdir: ' + mkdir.error };

  const rsync = run(`rsync -avz --delete "${localDir}/" "${server.alias}:${remoteDir}/"`, { timeout: 60000 });
  if (!rsync.success) return { error: 'rsync: ' + rsync.error };

  sovereignty.auditLog('INFO', 'deploy_vps', `${projectId} → ${server.alias}`, 'SENSITIVE');
  const url = opts.domain ? `https://${projectId}.${opts.domain}` : `http://${server.hostname}/${projectId}`;
  return { success: true, projectId, url, sshAlias: server.alias, remoteDir };
}

async function applyCorrections(projectId, base64Image, feedback) {
  const localDir = path.join(SITES_DIR, projectId);
  if (!fs.existsSync(localDir)) return { error: 'Projet non trouvé' };

  let visualFeedback = feedback || '';
  if (base64Image) {
    try {
      const bridge = require('./claude-api-bridge');
      const analysis = await bridge.callWithImage('Analyse ce rendu de site web. ' + (feedback || 'Identifie les problèmes visuels et améliorations.'), base64Image, 'image/jpeg');
      visualFeedback = (typeof analysis === 'string' ? analysis : analysis.content?.[0]?.text || '') + '\n' + (feedback || '');
    } catch (e) {}
  }

  const ccBridge = require('./claude-code-bridge');
  const result = await ccBridge.runClaudeCode(
    `Corrige ce site web dans ${localDir}/. Feedback: ${visualFeedback}. Modifie les fichiers existants pour améliorer le design.`,
    { cwd: localDir, timeout: 120000 }
  );
  return { success: true, projectId, corrections: result.output.slice(0, 500), visualAnalysis: visualFeedback.slice(0, 300) };
}

function listProjects() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs.readdirSync(SITES_DIR).filter(f => fs.statSync(path.join(SITES_DIR, f)).isDirectory()).map(id => {
    const dir = path.join(SITES_DIR, id);
    return { id, files: fs.readdirSync(dir).length, created: fs.statSync(dir).birthtime, size: run(`du -sh "${dir}" | cut -f1`).output || '?' };
  }).sort((a, b) => b.created - a.created);
}

module.exports = { createSite, deploySite, applyCorrections, listProjects, getSSHServers };
