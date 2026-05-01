'use strict';
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, 'knowledge', 'sessions');
const IDENTITY_FILE = path.join(__dirname, 'knowledge', 'prometheus-identity.json');

function getUserProfile() {
  try { return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8')); } catch { return {}; }
}

function saveUserProfile(updates) {
  const profile = getUserProfile();
  const updated = { ...profile, ...updates, lastUpdated: new Date().toISOString() };
  fs.mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

function buildCrossSessionContext(sessionId) {
  const profile = getUserProfile();
  const parts = [];
  if (profile.user_preferences?.length) parts.push('Preferences: ' + profile.user_preferences.slice(-5).join(', '));
  if (profile.projects_mentioned?.length) parts.push('Projets: ' + profile.projects_mentioned.slice(-3).join(', '));
  if (profile.decisions_made?.length) parts.push('Decisions recentes: ' + profile.decisions_made.slice(-3).join(', '));
  if (profile.important_facts?.length) parts.push('A retenir: ' + profile.important_facts.slice(-5).join(', '));
  return parts.length > 0 ? '\n[Contexte utilisateur]\n' + parts.join('\n') : '';
}

function getRecentSessionsSummary(currentSessionId, maxSessions) {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return '';
    const sessions = fs.readdirSync(SESSIONS_DIR)
      .filter(function(f) { return f.endsWith('.json') && f !== currentSessionId + '.json'; })
      .map(function(f) {
        try {
          var data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          var messages = Array.isArray(data) ? data : (data.messages || []);
          var stat = fs.statSync(path.join(SESSIONS_DIR, f));
          return { messages: messages, mtime: stat.mtime };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort(function(a, b) { return b.mtime - a.mtime; })
      .slice(0, maxSessions || 2);
    if (!sessions.length) return '';
    var summaries = sessions.map(function(s) {
      return s.messages.slice(-2).map(function(m) {
        return (m.role === 'user' ? 'U' : 'P') + ': ' + String(m.content || '').slice(0, 100);
      }).join(' | ');
    }).filter(Boolean);
    return summaries.length > 0 ? '\n[Sessions precedentes]\n' + summaries.join('\n') : '';
  } catch { return ''; }
}

async function updateProfile(message, response) {
  try {
    var bridge = require('./claude-api-bridge');
    var resp = await Promise.race([
      bridge.callFast('Extrait les faits importants de cet echange en JSON. User: ' + message.slice(0, 200) + ' Assistant: ' + response.slice(0, 200) + ' JSON: {"user_preferences":[],"decisions_made":[],"projects_mentioned":[],"important_facts":[]}', { maxTokens: 200 }),
      new Promise(function(r) { setTimeout(function() { r(null); }, 4000); })
    ]);
    if (!resp) return;
    var text = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) return;
    var facts = JSON.parse(match[0]);
    var profile = getUserProfile();
    var updated = {
      user_preferences: [...new Set([...(profile.user_preferences || []), ...(facts.user_preferences || [])])].slice(-20),
      decisions_made: [...new Set([...(profile.decisions_made || []), ...(facts.decisions_made || [])])].slice(-20),
      projects_mentioned: [...new Set([...(profile.projects_mentioned || []), ...(facts.projects_mentioned || [])])].slice(-10),
      important_facts: [...new Set([...(profile.important_facts || []), ...(facts.important_facts || [])])].slice(-30),
    };
    saveUserProfile(updated);
  } catch {}
}

module.exports = { getUserProfile: getUserProfile, saveUserProfile: saveUserProfile, buildCrossSessionContext: buildCrossSessionContext, getRecentSessionsSummary: getRecentSessionsSummary, updateProfile: updateProfile };
