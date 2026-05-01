'use strict';
const fs = require('fs');
const path = require('path');

const LTM_PATH = path.join(__dirname, 'knowledge', 'long-term-memory.json');

function load() {
  try { if (fs.existsSync(LTM_PATH)) return JSON.parse(fs.readFileSync(LTM_PATH, 'utf8')); } catch(e) {}
  return { version: '1.0', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), facts: [], projects: {}, decisions: [], preferences: {}, weeklyDigests: [] };
}
function save(ltm) { ltm.updatedAt = new Date().toISOString(); fs.mkdirSync(path.dirname(LTM_PATH), { recursive: true }); fs.writeFileSync(LTM_PATH, JSON.stringify(ltm, null, 2)); }

function addFact(fact, category = 'general') {
  const ltm = load();
  if (!ltm.facts.find(f => f.content.toLowerCase().includes(fact.toLowerCase().slice(0, 30)))) {
    ltm.facts.unshift({ content: fact, category, ts: new Date().toISOString(), confidence: 0.8 });
    if (ltm.facts.length > 100) ltm.facts.pop();
    save(ltm);
  }
}

function updateProject(name, status, details = '') {
  const ltm = load();
  ltm.projects[name] = { name, status, details, updatedAt: new Date().toISOString() };
  save(ltm);
}

async function generateWeeklySummary() {
  const ltm = load();
  const bridge = require('./claude-api-bridge');
  const chatDir = path.join(__dirname, 'chat-history');
  let recentContent = '';
  try {
    const files = fs.readdirSync(chatDir).map(f => ({ name: f, mtime: fs.statSync(path.join(chatDir, f)).mtime })).sort((a, b) => b.mtime - a.mtime).slice(0, 10);
    recentContent = files.map(f => { try { const d = JSON.parse(fs.readFileSync(path.join(chatDir, f.name), 'utf8')); const msgs = Array.isArray(d) ? d : (d.messages || []); return msgs.slice(-5).map(m => m.role + ': ' + String(m.content || '').slice(0, 100)).join('\n'); } catch(e) { return ''; } }).join('\n---\n');
  } catch(e) {}
  const resp = await bridge.call('Génère un résumé hebdomadaire. Projets: ' + Object.keys(ltm.projects).join(', ') + '. Faits: ' + ltm.facts.slice(0, 5).map(f => f.content).join(', ') + '. Activité: ' + recentContent.slice(0, 800) + '\nJSON: {"summary":"...","topProjects":[],"nextWeekSuggestions":[]}', { maxTokens: 400 });
  try {
    const text = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const digest = JSON.parse(text);
    digest.week = Math.ceil(((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 86400000 + new Date(new Date().getFullYear(), 0, 1).getDay() + 1) / 7);
    digest.ts = new Date().toISOString();
    ltm.weeklyDigests.unshift(digest);
    if (ltm.weeklyDigests.length > 52) ltm.weeklyDigests.pop();
    save(ltm);
    return digest;
  } catch(e) { return null; }
}

function buildLTMContext() {
  const ltm = load();
  const parts = [];
  if (ltm.facts.length > 0) { parts.push('[Mémoire longue terme]'); parts.push('Faits: ' + ltm.facts.slice(0, 5).map(f => f.content).join(' | ')); }
  const active = Object.values(ltm.projects).filter(p => p.status === 'active').slice(0, 5);
  if (active.length > 0) parts.push('Projets actifs: ' + active.map(p => p.name).join(', '));
  if (ltm.weeklyDigests.length > 0) parts.push('Semaine dernière: ' + (ltm.weeklyDigests[0].summary || '').slice(0, 150));
  return parts.join('\n');
}

async function extractAndStore(message, response) {
  try {
    const bridge = require('./claude-api-bridge');
    const resp = await Promise.race([
      bridge.call('Extrait les faits importants de cet échange pour la mémoire longue terme.\nUser: ' + message.slice(0, 200) + '\nAssistant: ' + response.slice(0, 200) + '\nJSON: {"facts":[],"projects":[{"name":"...","status":"active"}]}\nNe retourne que des faits vraiment importants.', { maxTokens: 200 }),
      new Promise(r => setTimeout(() => r(null), 4000))
    ]);
    if (!resp) return;
    const text = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const data = JSON.parse(text);
    (data.facts || []).forEach(f => addFact(f));
    (data.projects || []).forEach(p => updateProject(p.name, p.status, p.details || ''));
  } catch(e) {}
}

function getStats() { const ltm = load(); return { facts: ltm.facts.length, projects: Object.keys(ltm.projects).length, digests: ltm.weeklyDigests.length, lastUpdate: ltm.updatedAt }; }

module.exports = { load, save, addFact, updateProject, generateWeeklySummary, buildLTMContext, extractAndStore, getStats };
