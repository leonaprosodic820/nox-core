'use strict';
const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, 'knowledge');
const MEMORY_FILE = path.join(MEMORY_DIR, 'project-memory.json');
fs.mkdirSync(MEMORY_DIR, { recursive: true });

let memory = {
  user: { name: 'ShadowRoot', timezone: 'Europe/Paris', language: 'fr', preferences: {}, expertise: ['fullstack','security','opsec','privacy'], lastSeen: null },
  activeProjects: {},
  decisions: [],
  patterns: {},
  lastUpdated: null,
};

function loadMemory() {
  try { if (fs.existsSync(MEMORY_FILE)) memory = { ...memory, ...JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) }; } catch (e) {}
}
function saveMemory() {
  memory.lastUpdated = new Date().toISOString();
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); } catch (e) {}
}
loadMemory();

function updateSessionContext(sessionId, update) {
  if (!memory.activeProjects[sessionId]) {
    memory.activeProjects[sessionId] = { id: sessionId, createdAt: new Date().toISOString(), messages: 0, context: {}, tags: [] };
  }
  Object.assign(memory.activeProjects[sessionId], update);
  memory.activeProjects[sessionId].updatedAt = new Date().toISOString();
  saveMemory();
}

function learnFromConversation(sessionId, userMsg, assistantResp) {
  const proj = memory.activeProjects[sessionId] || { messages: 0 };
  proj.messages = (proj.messages || 0) + 1;

  const TECH = {
    languages: /\b(python|javascript|typescript|rust|go|java|swift|kotlin|ruby|php|c\+\+|c#)\b/gi,
    frameworks: /\b(react|vue|angular|next\.?js|express|fastapi|django|rails|spring|laravel)\b/gi,
    databases: /\b(postgres|mysql|mongodb|redis|sqlite|supabase|firebase|dynamodb)\b/gi,
    cloud: /\b(aws|gcp|azure|cloudflare|vercel|netlify|railway|render)\b/gi,
    tools: /\b(docker|kubernetes|terraform|nginx|pm2|git|github|gitlab)\b/gi,
  };
  const combined = userMsg + ' ' + assistantResp;
  const detected = {};
  Object.entries(TECH).forEach(([cat, rx]) => {
    const matches = [...new Set([...combined.matchAll(rx)].map(m => m[0].toLowerCase()))];
    if (matches.length) detected[cat] = matches;
  });
  if (Object.keys(detected).length) proj.techStack = { ...(proj.techStack || {}), ...detected };

  if (/erreur|error|bug|problème/i.test(userMsg) && /solution|résolu|fixed|corrigé/i.test(assistantResp)) {
    memory.decisions.push({ type: 'bug_fix', problem: userMsg.slice(0, 100), solution: assistantResp.slice(0, 200), session: sessionId, ts: new Date().toISOString() });
    if (memory.decisions.length > 100) memory.decisions.shift();
  }

  memory.activeProjects[sessionId] = proj;
  memory.user.lastSeen = new Date().toISOString();
  saveMemory();
}

function getActiveContext(sessionId) {
  const proj = memory.activeProjects[sessionId];
  const user = memory.user;
  const parts = [`Utilisateur: ${user.name} | TZ: ${user.timezone} | Expertise: ${user.expertise?.join(', ')}`];

  const recent = Object.values(memory.activeProjects).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 3);
  if (recent.length) parts.push('Projets récents: ' + recent.map(p => `${p.id} (${p.messages || 0} msgs)`).join(', '));
  if (proj?.techStack) {
    const stack = Object.values(proj.techStack).flat().join(', ');
    if (stack) parts.push('Stack: ' + stack);
  }
  const recentDec = memory.decisions.slice(-3);
  if (recentDec.length) parts.push('Décisions: ' + recentDec.map(d => `[${d.type}] ${d.problem?.slice(0, 50)}`).join(' | '));
  return parts.join('\n');
}

function updateUserProfile(updates) { Object.assign(memory.user, updates); saveMemory(); }
function getStats() { return { sessions: Object.keys(memory.activeProjects).length, decisions: memory.decisions.length, user: memory.user.name, lastUpdated: memory.lastUpdated }; }
function clearSession(id) { delete memory.activeProjects[id]; saveMemory(); }
function clearAll() { memory.activeProjects = {}; memory.decisions = []; saveMemory(); }

module.exports = { updateSessionContext, learnFromConversation, getActiveContext, updateUserProfile, getStats, clearSession, clearAll, getMemory: () => memory };
