'use strict';
/**
 * PROMETHEUS Self-Improvement v8.0
 * Auto-évaluation des réponses, détection patterns d'échec,
 * mise à jour automatique du system prompt
 */
const fs = require('fs');
const path = require('path');

const IMPROVE_DIR = path.join(__dirname, 'knowledge');
const RATINGS_FILE = path.join(IMPROVE_DIR, 'self-ratings.json');
const PATTERNS_FILE = path.join(IMPROVE_DIR, 'improvement-patterns.json');
const PROMPT_LOG = path.join(IMPROVE_DIR, 'prompt-evolution.json');
fs.mkdirSync(IMPROVE_DIR, { recursive: true });

let ratings = [];
let patterns = { successes: [], failures: [], rules: [] };
let promptHistory = [];

function loadAll() {
  try { if (fs.existsSync(RATINGS_FILE)) ratings = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8')); } catch (e) {}
  try { if (fs.existsSync(PATTERNS_FILE)) patterns = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8')); } catch (e) {}
  try { if (fs.existsSync(PROMPT_LOG)) promptHistory = JSON.parse(fs.readFileSync(PROMPT_LOG, 'utf8')); } catch (e) {}
}
function saveRatings() { try { fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings.slice(-500))); } catch (e) {} }
function savePatterns() { try { fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns)); } catch (e) {} }
function savePromptLog() { try { fs.writeFileSync(PROMPT_LOG, JSON.stringify(promptHistory.slice(-50))); } catch (e) {} }

loadAll();

// Auto-évaluer une réponse (1-10)
async function rateResponse(userMsg, response, context = {}) {
  const rating = { ts: new Date().toISOString(), userMsg: userMsg.slice(0, 200), responseLen: response.length };

  // Heuristiques de qualité locales (pas d'appel API)
  let score = 7; // Base

  // Longueur appropriée
  if (response.length < 10) score -= 3;
  else if (response.length < 50 && userMsg.length > 50) score -= 2;
  else if (response.length > 100) score += 1;

  // Contient du contenu structuré
  if (/```|##|\*\*|- /.test(response)) score += 1;

  // Contient des données concrètes (chiffres, dates)
  if (/\d{2,}|€|\$|°C|%/.test(response)) score += 1;

  // Détection d'erreurs dans la réponse
  if (/erreur|error|impossible|désolé|cannot|unable/i.test(response)) score -= 2;
  if (/❌|failed|timeout/i.test(response)) score -= 2;

  // Réponse vide ou générique
  if (/je ne sais pas|I don't know|pas d'information/i.test(response)) score -= 2;

  // Pertinence (mots-clés du message dans la réponse)
  const keywords = userMsg.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const found = keywords.filter(k => response.toLowerCase().includes(k));
  if (keywords.length > 0) {
    const relevance = found.length / keywords.length;
    if (relevance > 0.5) score += 1;
    if (relevance < 0.1 && keywords.length > 3) score -= 1;
  }

  // Web data injectée
  if (context.hasWebData) score += 1;

  // Clamp 1-10
  score = Math.max(1, Math.min(10, score));

  rating.score = score;
  rating.keywords = keywords.slice(0, 5);
  rating.relevance = keywords.length ? (found.length / keywords.length).toFixed(2) : 'N/A';

  ratings.push(rating);
  if (ratings.length % 10 === 0) saveRatings();

  // Détecter les patterns
  detectPatterns(rating, response);

  return rating;
}

// Analyser les patterns d'échec/succès
function detectPatterns(rating, response) {
  if (rating.score <= 4) {
    // Pattern d'échec
    const failPattern = {
      ts: rating.ts,
      score: rating.score,
      keywords: rating.keywords,
      responseSnippet: response.slice(0, 100),
      category: categorizeFailure(response),
    };
    patterns.failures.push(failPattern);
    if (patterns.failures.length > 100) patterns.failures.shift();

    // Générer une règle d'amélioration
    const rule = generateRule(failPattern);
    if (rule && !patterns.rules.find(r => r.category === rule.category)) {
      patterns.rules.push(rule);
    }
  } else if (rating.score >= 8) {
    patterns.successes.push({
      ts: rating.ts, score: rating.score, keywords: rating.keywords,
    });
    if (patterns.successes.length > 100) patterns.successes.shift();
  }

  if (ratings.length % 20 === 0) savePatterns();
}

function categorizeFailure(response) {
  if (/timeout|Timeout/i.test(response)) return 'timeout';
  if (/error|erreur/i.test(response)) return 'error';
  if (response.length < 30) return 'too_short';
  if (/je ne sais pas|pas d'information/i.test(response)) return 'no_knowledge';
  if (/impossible|cannot/i.test(response)) return 'capability_limit';
  return 'quality';
}

function generateRule(failPattern) {
  const rules = {
    timeout: { category: 'timeout', rule: 'Réduire les timeouts API. Utiliser le cache plus agressivement.', priority: 'high' },
    error: { category: 'error', rule: 'Ajouter des fallbacks pour les sources qui échouent.', priority: 'high' },
    too_short: { category: 'too_short', rule: 'Fournir des réponses plus détaillées quand la question est complexe.', priority: 'medium' },
    no_knowledge: { category: 'no_knowledge', rule: 'Utiliser la recherche web quand les connaissances sont insuffisantes.', priority: 'medium' },
    capability_limit: { category: 'capability_limit', rule: 'Proposer des alternatives quand une action directe est impossible.', priority: 'low' },
    quality: { category: 'quality', rule: 'Améliorer la pertinence en détectant mieux l\'intent.', priority: 'medium' },
  };
  return rules[failPattern.category] || null;
}

// Générer des améliorations pour le system prompt
function generatePromptImprovements() {
  const recentRatings = ratings.slice(-50);
  if (recentRatings.length < 10) return { improvements: [], reason: 'Pas assez de données' };

  const avgScore = recentRatings.reduce((s, r) => s + r.score, 0) / recentRatings.length;
  const failCount = recentRatings.filter(r => r.score <= 4).length;
  const successCount = recentRatings.filter(r => r.score >= 8).length;

  const improvements = [];

  // Analyser les catégories d'échec
  const failCategories = {};
  patterns.failures.slice(-30).forEach(f => {
    failCategories[f.category] = (failCategories[f.category] || 0) + 1;
  });

  Object.entries(failCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .forEach(([cat, count]) => {
      const rule = patterns.rules.find(r => r.category === cat);
      if (rule) improvements.push({ category: cat, count, suggestion: rule.rule, priority: rule.priority });
    });

  // Log l'évolution
  promptHistory.push({
    ts: new Date().toISOString(),
    avgScore: +avgScore.toFixed(2),
    failCount, successCount, total: recentRatings.length,
    improvements: improvements.length,
    topFailCategory: Object.entries(failCategories).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
  });
  savePromptLog();

  return {
    avgScore: +avgScore.toFixed(2),
    failRate: +(failCount / recentRatings.length * 100).toFixed(1) + '%',
    successRate: +(successCount / recentRatings.length * 100).toFixed(1) + '%',
    improvements,
    activeRules: patterns.rules,
  };
}

// Générer le contexte d'amélioration pour le system prompt
function getImprovementContext() {
  if (patterns.rules.length === 0) return '';
  const rules = patterns.rules.slice(-5).map(r => `- ${r.rule}`).join('\n');
  return `\n[AUTO-AMÉLIORATION]\n${rules}`;
}

function getStats() {
  const recent = ratings.slice(-50);
  return {
    totalRatings: ratings.length,
    avgScore: recent.length ? +(recent.reduce((s, r) => s + r.score, 0) / recent.length).toFixed(2) : 0,
    failPatterns: patterns.failures.length,
    successPatterns: patterns.successes.length,
    activeRules: patterns.rules.length,
    promptEvolutions: promptHistory.length,
  };
}

function getRatings(limit = 20) { return ratings.slice(-limit); }
function getEvolution() { return promptHistory.slice(-20); }

module.exports = {
  rateResponse, generatePromptImprovements, getImprovementContext,
  getStats, getRatings, getEvolution, detectPatterns,
};
