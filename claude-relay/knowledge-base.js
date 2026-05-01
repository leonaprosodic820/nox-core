const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, 'knowledge');
fs.mkdirSync(KB_DIR, { recursive: true });

const GLOBAL_PATH = path.join(KB_DIR, 'global.json');

function loadGlobal() {
  try { return JSON.parse(fs.readFileSync(GLOBAL_PATH, 'utf-8')); }
  catch { return { successPatterns: [], failurePatterns: [], bestPractices: [], technologyNotes: {}, errorSolutions: {}, createdAt: new Date().toISOString() }; }
}

function saveGlobal(kb) {
  kb.updatedAt = new Date().toISOString();
  fs.writeFileSync(GLOBAL_PATH, JSON.stringify(kb, null, 2));
}

function addSuccessPattern(pattern, context) {
  const kb = loadGlobal();
  kb.successPatterns.unshift({ pattern, context, timestamp: new Date().toISOString() });
  kb.successPatterns = kb.successPatterns.slice(0, 100);
  saveGlobal(kb);
}

function addFailurePattern(pattern, solution) {
  const kb = loadGlobal();
  kb.failurePatterns.unshift({ pattern, solution, timestamp: new Date().toISOString() });
  kb.failurePatterns = kb.failurePatterns.slice(0, 100);
  saveGlobal(kb);
}

function addErrorSolution(errorMessage, solution) {
  const kb = loadGlobal();
  kb.errorSolutions[errorMessage.slice(0, 100)] = { solution, addedAt: new Date().toISOString() };
  saveGlobal(kb);
}

function findSolution(errorMessage) {
  const kb = loadGlobal();
  const key = Object.keys(kb.errorSolutions).find(k => errorMessage.toLowerCase().includes(k.toLowerCase()));
  return key ? kb.errorSolutions[key] : null;
}

function loadForSession(sessionId) {
  const p = path.join(KB_DIR, `${(sessionId || 'default').replace(/[^a-zA-Z0-9-_]/g, '_')}.json`);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function saveForSession(sessionId, data) {
  const p = path.join(KB_DIR, `${(sessionId || 'default').replace(/[^a-zA-Z0-9-_]/g, '_')}.json`);
  const existing = loadForSession(sessionId);
  Object.assign(existing, data);
  existing.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(existing, null, 2));
}

function getRelevantContext(sessionId) {
  return { global: loadGlobal(), session: loadForSession(sessionId) };
}

module.exports = { loadGlobal, saveGlobal, addSuccessPattern, addFailurePattern, addErrorSolution, findSolution, loadForSession, saveForSession, getRelevantContext };
