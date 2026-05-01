'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CAUSAL_FILE = path.join(__dirname, 'knowledge', 'causal-graph.json');
fs.mkdirSync(path.dirname(CAUSAL_FILE), { recursive: true });

let graph = { events: [], relations: [], patterns: [], predictions: [] };
function load() { try { if (fs.existsSync(CAUSAL_FILE)) graph = JSON.parse(fs.readFileSync(CAUSAL_FILE, 'utf8')); } catch (e) {} }
function save() { try { fs.writeFileSync(CAUSAL_FILE, JSON.stringify(graph, null, 2)); } catch (e) {} }
load();

function addEvent(event) {
  const evt = {
    id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    type: event.type || 'general', title: (event.title || '').slice(0, 120),
    detail: (event.detail || '').slice(0, 300),
    techStack: event.techStack || [], sessionId: event.sessionId || '',
    severity: event.severity || 'normal',
  };
  graph.events.push(evt);
  if (graph.events.length > 5000) graph.events.shift();
  detectCausalRelations(evt);
  save();
  return evt.id;
}

function detectCausalRelations(newEvent) {
  const recent = graph.events.slice(-100).filter(e => e.id !== newEvent.id);

  if (newEvent.type === 'bug_introduced' || newEvent.type === 'error_occurred') {
    const decisions = recent.filter(e => e.type === 'decision_made' && e.techStack.some(t => newEvent.techStack.includes(t)));
    decisions.forEach(d => {
      const days = Math.round((new Date(newEvent.timestamp) - new Date(d.timestamp)) / 86400000);
      if (days >= 0 && days <= 30) {
        graph.relations.push({
          id: crypto.randomUUID(), cause: d.id, effect: newEvent.id,
          type: 'decision_caused_bug', strength: days < 7 ? 'strong' : 'possible',
          daysBetween: days, description: `"${d.title}" (${days}j) → "${newEvent.title}"`,
        });
      }
    });

    const similar = recent.filter(e => (e.type === 'bug_introduced' || e.type === 'error_occurred') && e.techStack.some(t => newEvent.techStack.includes(t)));
    if (similar.length >= 2) {
      const exists = graph.patterns.some(p => p.type === 'recurring_bug' && p.techStack.join(',') === newEvent.techStack.join(','));
      if (!exists) {
        graph.patterns.push({
          id: crypto.randomUUID(), type: 'recurring_bug',
          events: [...similar.map(b => b.id), newEvent.id], techStack: newEvent.techStack,
          count: similar.length + 1,
          message: `${similar.length + 1} bugs récurrents sur ${newEvent.techStack.join(', ')}`,
          recommendation: `Refactorisation recommandée pour ${newEvent.techStack[0]}`,
        });
      }
    }
  }
}

async function generatePredictions() {
  if (graph.events.length < 5) return graph.predictions;
  try {
    const bridge = require('./claude-api-bridge');
    const ctx = graph.events.slice(-20).map(e => `[${e.timestamp.slice(0, 10)}] ${e.type}: ${e.title}`).join('\n');
    const patterns = graph.patterns.slice(-5).map(p => p.message).join('\n');
    const r = await bridge.callFast(
      `Analyse ces événements de dev et génère 3 prédictions causales. JSON: [{"prediction":"...","probability":"high|medium|low","timeframe":"X jours","recommendation":"..."}]\n\nÉvénements:\n${ctx}\n\nPatterns:\n${patterns}`,
      { maxTokens: 400 }
    );
    const text = typeof r === 'string' ? r : r.content?.[0]?.text || '';
    const m = text.match(/\[[\s\S]*\]/);
    if (m) { graph.predictions = JSON.parse(m[0]).map(p => ({ ...p, id: crypto.randomUUID(), generatedAt: new Date().toISOString() })); save(); }
  } catch (e) {}
  return graph.predictions;
}

async function analyzeCausality(situation) {
  try {
    const bridge = require('./claude-api-bridge');
    const ctx = graph.events.slice(-30).map(e => `[${e.timestamp.slice(0, 10)}] ${e.type}: ${e.title}`).join('\n');
    const r = await bridge.callFast(
      `Situation: "${situation}"\nHistorique:\n${ctx}\n\nAnalyse causale concise: 1) Cause probable 2) Décisions passées liées 3) Prédiction si rien ne change 4) Solution recommandée`,
      { maxTokens: 500 }
    );
    const text = typeof r === 'string' ? r : r.content?.[0]?.text || '';
    return { situation, analysis: text, relatedEvents: graph.events.filter(e => situation.toLowerCase().split(/\W+/).some(w => w.length > 3 && e.title.toLowerCase().includes(w))).slice(0, 5) };
  } catch (e) { return { situation, error: e.message }; }
}

function extractEventFromConversation(message, response) {
  const content = message + ' ' + response;
  let type = null;
  if (/bug|erreur|error|ça marche pas|broken/i.test(message)) {
    type = /résolu|fixed|corrigé|trouvé/i.test(response) ? 'bug_fixed' : 'bug_introduced';
  } else if (/décid|choisi|on va utiliser|on va faire/i.test(content)) {
    type = 'decision_made';
  } else if (/ajout|créé|implémenté|déployé|installé/i.test(response)) {
    type = 'feature_added';
  } else if (/lent|slow|performance|timeout|crash/i.test(content)) {
    type = 'performance_issue';
  }
  if (!type) return null;
  const techs = content.match(/\b(node|python|react|vue|postgres|redis|docker|nginx|pm2|claude|llama|express|server|api|database|auth|jwt)\b/gi) || [];
  return addEvent({ type, title: message.slice(0, 80), detail: response.slice(0, 200), techStack: [...new Set(techs.map(t => t.toLowerCase()))], severity: type.includes('bug') ? 'high' : 'normal' });
}

function getStats() {
  return { events: graph.events.length, relations: graph.relations.length, patterns: graph.patterns.length, predictions: graph.predictions.length };
}

module.exports = { addEvent, detectCausalRelations, generatePredictions, analyzeCausality, extractEventFromConversation, getStats, get causalGraph() { return graph; } };
