'use strict';

const fs = require('fs');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'knowledge', 'self-metrics.json');
const MAX_HISTORY = 1000;

const UNCERTAIN_WORDS = [
  'maybe', 'perhaps', 'probably', 'possibly', 'might', 'could be',
  'not sure', 'i think', 'i believe', 'it seems', 'apparently',
  'peut-être', 'probablement', 'je pense', 'il me semble', 'environ'
];

let metrics = [];
let mentalState = {
  lastConfidence: null,
  lastSignal: null,
  lastVerdict: null,
  averageConfidence: 0,
  totalResponses: 0
};

function ensureStorage() {
  try {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  } catch (e) { /* ignore */ }
}

function loadMetrics() {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    const data = JSON.parse(raw);
    metrics = Array.isArray(data.metrics) ? data.metrics : [];
    if (data.mentalState) mentalState = data.mentalState;
  } catch (e) {
    metrics = [];
  }
}

function saveMetrics() {
  try {
    ensureStorage();
    fs.writeFileSync(STORAGE_PATH, JSON.stringify({
      metrics: metrics.slice(-MAX_HISTORY),
      mentalState,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) { /* ignore */ }
}

function analyzeResponse(response, question) {
  if (!response || typeof response !== 'string') {
    return { confidence: 0, signal: '🔴', verdict: 'EMPTY', uncertainWords: 0, factualClaims: 0 };
  }

  let confidence = 85; // Start with moderate-high baseline
  const lower = response.toLowerCase();

  // Count uncertain words
  let uncertainCount = 0;
  for (const word of UNCERTAIN_WORDS) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = lower.match(regex);
    if (matches) uncertainCount += matches.length;
  }
  confidence -= uncertainCount * 8;

  // Count factual claims (numbers, dates, percentages)
  const factualClaims = (response.match(/\b\d{4}\b|\b\d+%|\b\d+\.\d+\b/g) || []).length;

  // Response completeness
  if (response.length < 20) confidence -= 15;
  else if (response.length > 50 && response.length < 500) confidence += 5;

  // Question relevance (simple keyword overlap)
  if (question && typeof question === 'string') {
    const qWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const rWords = lower.split(/\s+/);
    const overlap = qWords.filter(w => rWords.some(r => r.includes(w))).length;
    const relevance = qWords.length > 0 ? overlap / qWords.length : 0.5;
    if (relevance < 0.1) confidence -= 15;
    else if (relevance > 0.3) confidence += 5;
  }

  // Code blocks suggest concrete answers
  if (/```/.test(response)) confidence += 5;

  // Clamp
  confidence = Math.max(0, Math.min(100, confidence));

  let signal, verdict;
  if (confidence >= 80) { signal = '🟢'; verdict = 'HIGH_CONFIDENCE'; }
  else if (confidence >= 50) { signal = '🟡'; verdict = 'MODERATE_CONFIDENCE'; }
  else { signal = '🔴'; verdict = 'LOW_CONFIDENCE'; }

  const entry = {
    confidence,
    signal,
    verdict,
    uncertainWords: uncertainCount,
    factualClaims,
    responseLength: response.length,
    timestamp: new Date().toISOString()
  };

  // Update state
  metrics.push(entry);
  if (metrics.length > MAX_HISTORY) metrics = metrics.slice(-MAX_HISTORY);

  mentalState.lastConfidence = confidence;
  mentalState.lastSignal = signal;
  mentalState.lastVerdict = verdict;
  mentalState.totalResponses++;
  mentalState.averageConfidence = Math.round(
    metrics.reduce((s, m) => s + m.confidence, 0) / metrics.length
  );

  saveMetrics();

  return entry;
}

function getState() {
  return {
    ...mentalState,
    metricsCount: metrics.length,
    lastMetric: metrics.length > 0 ? metrics[metrics.length - 1] : null
  };
}

function getMetrics(n) {
  const count = n || 50;
  return metrics.slice(-count);
}

// Load on require
loadMetrics();

module.exports = { analyzeResponse, getState, getMetrics };
