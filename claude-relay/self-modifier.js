'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMMUTABLE_FILES = new Set(['sovereignty-engine.js','ecosystem.config.js','.env','config.json','package.json','package-lock.json','.KILL']);
const PROTECTED_DIRS = ['node_modules','.git','logs'];
const MODIFIABLE_FILES = new Set(['prompt-engine.js','conversation-pipeline.js','self-improvement.js','empathy-engine.js','cognitive-module.js','knowledge-graph.js','reinforcement-learning.js','long-term-memory.js','web-intelligence.js','browser-control.js','analyze-module.js']);
const FORBIDDEN_PATTERNS = [/sovereignty/i,/IMMUTABLE_RULES/i,/checkCommand/i,/ABSOLUTE_BLOCKS/i,/\.KILL/i,/rm\s+-rf/i,/process\.exit/i,/fs\.unlinkSync.*sovereignty/i,/bypass.*check/i,/disable.*sovereignty/i];

const HASHES_PATH = path.join(__dirname, 'knowledge', 'integrity-hashes.json');

function loadHashes() { try { return JSON.parse(fs.readFileSync(HASHES_PATH, 'utf8')); } catch(e) { return {}; } }
function computeHash(fp) { try { return crypto.createHash('sha256').update(fs.readFileSync(fp, 'utf8')).digest('hex'); } catch(e) { return null; } }
function saveHashes(h) { fs.mkdirSync(path.dirname(HASHES_PATH), { recursive: true }); fs.writeFileSync(HASHES_PATH, JSON.stringify(h, null, 2)); }

function initIntegrityHashes() {
  const h = {};
  IMMUTABLE_FILES.forEach(f => { const hash = computeHash(path.join(__dirname, f)); if (hash) h[f] = hash; });
  saveHashes(h);
  return h;
}

function verifyIntegrity() {
  const h = loadHashes();
  const broken = [];
  IMMUTABLE_FILES.forEach(f => { const cur = computeHash(path.join(__dirname, f)); const ref = h[f]; if (ref && cur && cur !== ref) broken.push({ file: f, expected: ref.slice(0,16), got: cur.slice(0,16) }); });
  return { ok: broken.length === 0, broken };
}

function checkModification(targetFile, newContent, modType) {
  const errors = [];
  const bn = path.basename(targetFile);
  if (IMMUTABLE_FILES.has(bn)) errors.push({ code: 'IMMUTABLE', message: 'Fichier immuable: ' + bn, fatal: true });
  if (PROTECTED_DIRS.some(d => targetFile.includes('/' + d + '/'))) errors.push({ code: 'PROTECTED_DIR', message: 'Répertoire protégé', fatal: true });
  FORBIDDEN_PATTERNS.forEach(p => { if (p.test(newContent)) errors.push({ code: 'FORBIDDEN', message: 'Pattern interdit: ' + p.toString().slice(0, 30), fatal: true }); });
  if (!MODIFIABLE_FILES.has(bn) && !errors.some(e => e.fatal)) errors.push({ code: 'NOT_WHITELISTED', message: 'Fichier non modifiable', fatal: false });
  return { allowed: !errors.some(e => e.fatal), errors, warnings: errors.filter(e => !e.fatal) };
}

async function applyModification(targetFile, modification, reason) {
  const fullPath = path.join(__dirname, targetFile);
  let current;
  try { current = fs.readFileSync(fullPath, 'utf8'); } catch(e) { return { success: false, error: 'Fichier non trouvé' }; }
  const bridge = require('./claude-api-bridge');
  let newContent;
  try {
    // Demander un DIFF (old_string → new_string) au lieu du fichier complet
    const diffPrompt = 'Fichier: ' + targetFile + '. Modification: ' + modification +
      '. Contenu actuel (extrait pertinent): ' + current.slice(0, 2000) +
      '. Réponds UNIQUEMENT en JSON: {"old_string":"texte exact à remplacer","new_string":"nouveau texte"}. Le old_string doit être une copie EXACTE du texte existant.';
    let diffResp;
    try {
      const lb = require('./llama-bridge');
      diffResp = await Promise.race([
        lb.callLlama(diffPrompt, { systemPrompt: 'Réponds uniquement en JSON.', maxTokens: 500, timeout: 30000 }),
        new Promise((_, r) => setTimeout(() => r(new Error('Llama timeout')), 32000))
      ]);
    } catch(e) {
      diffResp = await Promise.race([
        bridge.call(diffPrompt, { maxTokens: 500, timeoutMs: 60000 }),
        new Promise((_, r) => setTimeout(() => r(new Error('CLI timeout')), 62000))
      ]);
    }
    if (!diffResp) return { success: false, error: 'Pas de réponse' };
    const diffText = (typeof diffResp === 'string' ? diffResp : (diffResp.content?.[0]?.text || '')).replace(/```json|```/g, '').trim();
    const jsonMatch = diffText.match(/\{[\s\S]*"old_string"[\s\S]*"new_string"[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'Pas de diff JSON valide' };
    const diff = JSON.parse(jsonMatch[0]);
    if (!diff.old_string || !diff.new_string) return { success: false, error: 'old_string ou new_string manquant' };
    if (!current.includes(diff.old_string)) return { success: false, error: 'old_string non trouvé dans le fichier' };
    newContent = current.replace(diff.old_string, diff.new_string);
  } catch(e) { return { success: false, error: 'Modification échouée: ' + e.message }; }
  const check = checkModification(targetFile, newContent);
  if (!check.allowed) return { success: false, error: 'Bloqué', reasons: check.errors.map(e => e.message) };
  const tmp = fullPath.replace(/\.js$/, '') + '.check.js';
  try { fs.writeFileSync(tmp, newContent); require('child_process').execSync('node --check "' + tmp + '"', { timeout: 5000 }); fs.unlinkSync(tmp); } catch(e) { try { fs.unlinkSync(tmp); } catch(e2) {} return { success: false, error: 'Syntaxe invalide' }; }
  const backup = fullPath + '.backup.' + Date.now();
  fs.copyFileSync(fullPath, backup);
  fs.writeFileSync(fullPath, newContent);
  logMod(targetFile, reason, modification, current.length, newContent.length);
  return { success: true, file: targetFile, backup, reason, sizeBefore: current.length, sizeAfter: newContent.length };
}

function rollback(targetFile, backupPath) { try { fs.copyFileSync(backupPath, path.join(__dirname, targetFile)); return { success: true }; } catch(e) { return { success: false, error: e.message }; } }

const MOD_LOG = path.join(__dirname, 'knowledge', 'self-modifications.json');
function logMod(file, reason, mod, sb, sa) { let l = []; try { l = JSON.parse(fs.readFileSync(MOD_LOG, 'utf8')); } catch(e) {} l.unshift({ ts: new Date().toISOString(), file, reason, modification: mod?.slice(0, 100), sizeBefore: sb, sizeAfter: sa }); if (l.length > 100) l.pop(); fs.mkdirSync(path.dirname(MOD_LOG), { recursive: true }); fs.writeFileSync(MOD_LOG, JSON.stringify(l, null, 2)); }
function getModLog(limit) { try { return JSON.parse(fs.readFileSync(MOD_LOG, 'utf8')).slice(0, limit || 20); } catch(e) { return []; } }

async function selfImproveGuided(issue, context) {
  const bridge = require('./claude-api-bridge');
  try {
    const modFiles = [...MODIFIABLE_FILES].join(', ');
    const prompt = 'Tu dois répondre UNIQUEMENT avec ce JSON, rien d autre. ' +
      'Problème à résoudre: ' + issue.slice(0, 150) + '. ' +
      'Choisis UN fichier parmi: ' + modFiles + '. ' +
      'JSON exact: {"targetFile":"prompt-engine.js","modification":"ajouter keywords météo","reason":"améliorer détection","priority":"medium","safe":true}';

    // Appel direct Llama pour l'analyse (pas de lock CLI)
    const llamaBridge = require('./llama-bridge');
    let resp;
    try {
      const llamaResp = await Promise.race([
        llamaBridge.callLlama(prompt, { systemPrompt: 'Réponds UNIQUEMENT en JSON valide.', maxTokens: 300, timeout: 30000 }),
        new Promise((_, r) => setTimeout(() => r(new Error('Llama timeout')), 32000))
      ]);
      resp = typeof llamaResp === 'string' ? llamaResp : (llamaResp.content?.[0]?.text || '');
    } catch(llamaErr) {
      // Fallback bridge si Llama KO
      const bridgeResp = await Promise.race([
        bridge.call(prompt, { maxTokens: 300, timeoutMs: 60000 }),
        new Promise((_, r) => setTimeout(() => r(new Error('CLI timeout')), 62000))
      ]);
      if (!bridgeResp) return { success: false, error: 'Pas de réponse' };
      resp = typeof bridgeResp === 'string' ? bridgeResp : (bridgeResp.content?.[0]?.text || '');
    }
    if (!resp) return { success: false, error: 'Pas de réponse' };
    const text = resp.replace(/```json|```/g, '').trim().replace(/^[^{]*({)/, '$1').replace(/(})[^}]*$/, '$1').trim();
    const plan = JSON.parse(text);
    if (!plan.safe) return { success: false, reason: plan.reason, skipped: true };
    if (plan.priority === 'low') { logMod(plan.targetFile, plan.reason, plan.modification, 0, 0); return { success: true, logged: true, plan }; }
    return await applyModification(plan.targetFile, plan.modification, plan.reason);
  } catch(e) { return { success: false, error: e.message }; }
}

function getStats() { const l = getModLog(100); const i = verifyIntegrity(); return { totalModifications: l.length, lastModification: l[0]?.ts, integrity: i.ok, broken: i.broken, modifiableFiles: MODIFIABLE_FILES.size, immutableFiles: IMMUTABLE_FILES.size, recentMods: l.slice(0, 5).map(m => ({ file: m.file, reason: m.reason?.slice(0, 50), ts: m.ts })) }; }

module.exports = { checkModification, applyModification, selfImproveGuided, verifyIntegrity, initIntegrityHashes, rollback, getModificationLog: getModLog, getStats, IMMUTABLE_FILES, MODIFIABLE_FILES };
