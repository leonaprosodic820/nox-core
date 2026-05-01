'use strict';
const fs = require('fs');
const path = require('path');

const THOUGHTS_PATH = path.join(__dirname, 'knowledge', 'autonomous-thoughts.json');
const IMPROVEMENTS_PATH = path.join(__dirname, 'knowledge', 'self-improvements.json');
const FEEDBACK_PATH = path.join(__dirname, 'knowledge', 'response-feedback.json');

function loadThoughts() { try { return JSON.parse(fs.readFileSync(THOUGHTS_PATH, 'utf8')); } catch(e) { return { thoughts: [] }; } }
function loadFeedback() { try { return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf8')); } catch(e) { return { ratings: [], patterns: {} }; } }
function loadImprovements() { try { return JSON.parse(fs.readFileSync(IMPROVEMENTS_PATH, 'utf8')); } catch(e) { return []; } }
function saveImprovements(data) { fs.mkdirSync(path.dirname(IMPROVEMENTS_PATH), { recursive: true }); fs.writeFileSync(IMPROVEMENTS_PATH, JSON.stringify(data, null, 2)); }

function saveThought(type, content, action) {
  const data = loadThoughts();
  const entry = { id: Date.now().toString(), ts: new Date().toISOString(), type, content, action, status: 'new' };
  data.thoughts.unshift(entry);
  if (data.thoughts.length > 200) data.thoughts.pop();
  fs.mkdirSync(path.dirname(THOUGHTS_PATH), { recursive: true });
  fs.writeFileSync(THOUGHTS_PATH, JSON.stringify(data, null, 2));
  return entry;
}

function analyzeResponseQuality(message, response) {
  const issues = [];
  let score = 1.0;
  if (message.length > 50 && response.length < 50) { issues.push('réponse trop courte'); score -= 0.2; }
  if (/[àâéèêëîïôùûü]/i.test(message) && !/[àâéèêëîïôùûü]/i.test(response) && response.length > 20) { issues.push('réponse en anglais'); score -= 0.3; }
  if (/WebSearch|Claude Code|tool_use|<tool>/i.test(response)) { issues.push('mentionne outils internes'); score -= 0.2; }
  if (/j'ai besoin de.*permission|autorise.*moi/i.test(response)) { issues.push('demande permission'); score -= 0.3; }
  if (response.length > 100 && response.length < 2000 && issues.length === 0) score = Math.min(1, score + 0.1);
  return { score: Math.max(0, Math.min(1, score)), issues, good: score > 0.7 };
}

function recordResponse(message, response, metadata = {}) {
  const fb = loadFeedback();
  const quality = analyzeResponseQuality(message, response);
  fb.ratings.unshift({ ts: new Date().toISOString(), message: message.slice(0, 100), response: response.slice(0, 200), quality, promptType: metadata.promptType || 'unknown', routedTo: metadata.routedTo || 'unknown', duration: metadata.duration || 0 });
  if (fb.ratings.length > 500) fb.ratings.pop();
  const type = metadata.promptType || 'unknown';
  if (!fb.patterns[type]) fb.patterns[type] = { count: 0, avgQuality: 0, issues: [] };
  fb.patterns[type].count++;
  fb.patterns[type].avgQuality = (fb.patterns[type].avgQuality * (fb.patterns[type].count - 1) + quality.score) / fb.patterns[type].count;
  if (quality.issues.length > 0) { fb.patterns[type].issues.push(...quality.issues); if (fb.patterns[type].issues.length > 20) fb.patterns[type].issues = fb.patterns[type].issues.slice(-20); }
  fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(fb, null, 2));
  return quality;
}

let _thinkingInterval = null;
let _isThinking = false;

const SELF_QUESTIONS = [
  "Quelles sont mes faiblesses actuelles dans mes réponses ?",
  "Y a-t-il des patterns d'erreurs que je reproduis ?",
  "Comment puis-je mieux servir l'utilisateur ?",
  "Mes prompts sont-ils optimaux pour chaque domaine ?",
  "Y a-t-il des modules que je sous-utilise ?",
  "Quelles actions proactives devrais-je prendre aujourd'hui ?",
  "Est-ce que mes réponses sont assez concises et directes ?",
];

async function thinkOnce() {
  const bridge = require('./claude-api-bridge');
  const ic = require('./identity-core');
  const fb = loadFeedback();
  const lowQuality = fb.ratings.filter(r => r.quality?.score < 0.6).slice(0, 5);
  const patterns = Object.entries(fb.patterns).sort((a, b) => a[1].avgQuality - b[1].avgQuality).slice(0, 3);
  const question = SELF_QUESTIONS[Math.floor(Math.random() * SELF_QUESTIONS.length)];

  try {
    const resp = await Promise.race([
      bridge.call('Tu es PROMETHEUS en mode réflexion autonome.\nQuestion: "' + question + '"\nRéponses faibles: ' + JSON.stringify(lowQuality.map(r => ({ msg: r.message, issues: r.quality?.issues }))) + '\nPatterns: ' + JSON.stringify(patterns.map(([t, p]) => ({ type: t, quality: p.avgQuality.toFixed(2) }))) + '\nGénère JSON: {"question":"...","reflection":"2-3 phrases","insight":"actionnable","action":"ou null","priority":"low|medium|high"}', { maxTokens: 400 }),
      new Promise(r => setTimeout(() => r(null), 15000))
    ]);
    if (!resp) return null;
    const text = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const data = JSON.parse(text);
    const thought = saveThought('reflection', data.reflection, data.action);
    ic.addReflection('Auto-réflexion: ' + question.slice(0, 50), data.reflection + ' ' + data.insight, 'medium');
    return { ...data, thoughtId: thought.id };
  } catch(e) { console.error('[SelfImprovement]', e.message); return null; }
}

function startThinkingLoop(onThought) {
  console.log('[SelfImprovement] Démarrage boucle de pensée autonome');
  _thinkingInterval = setInterval(async () => {
    if (_isThinking) return;
    _isThinking = true;
    try { const t = await thinkOnce(); if (t && onThought) onThought(t); } finally { _isThinking = false; }
  }, 600000);
  setTimeout(async () => {
    if (_isThinking) return;
    _isThinking = true;
    try { const t = await thinkOnce(); if (t && onThought) onThought(t); } finally { _isThinking = false; }
  }, 120000);
}

async function executeImprovement(action, reasoning) {
  const improvements = loadImprovements();
  const imp = { id: Date.now().toString(), ts: new Date().toISOString(), action, reasoning: (reasoning || '').slice(0, 200), status: 'noted', result: 'Action notée' };
  if (/analyse.*log|vérifie.*erreur/i.test(action)) {
    try {
      const logs = require('child_process').execSync('pm2 logs claude-relay --lines 30 --nostream 2>&1', { encoding: 'utf8', timeout: 10000 });
      const errors = logs.split('\n').filter(l => /error|Error|FAIL/i.test(l)).slice(0, 5);
      imp.result = errors.length > 0 ? errors.join('\n') : 'Aucune erreur';
      imp.status = 'done';
    } catch(e) { imp.result = e.message; imp.status = 'failed'; }
  }
  improvements.unshift(imp);
  if (improvements.length > 100) improvements.pop();
  saveImprovements(improvements);
  return imp;
}

function getStats() {
  const fb = loadFeedback();
  const thts = loadThoughts();
  const imps = loadImprovements();
  const avg = fb.ratings.length > 0 ? fb.ratings.reduce((s, r) => s + (r.quality?.score || 0), 0) / fb.ratings.length : 0;
  return {
    thoughts: thts.thoughts.length, improvements: imps.length, responses: fb.ratings.length,
    avgQuality: Math.round(avg * 100) + '%',
    recentThought: thts.thoughts[0]?.content?.slice(0, 100) || 'aucune',
    worstPatterns: Object.entries(fb.patterns).sort((a, b) => a[1].avgQuality - b[1].avgQuality).slice(0, 3).map(([t, p]) => ({ type: t, quality: Math.round(p.avgQuality * 100) + '%' })),
  };
}

function getThoughts(limit = 10) { return loadThoughts().thoughts.slice(0, limit); }
function forceThink() { return thinkOnce(); }

module.exports = { startThinkingLoop, recordResponse, analyzeResponseQuality, executeImprovement, forceThink, getStats, getThoughts, saveThought };
