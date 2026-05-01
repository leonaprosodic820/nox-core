'use strict';
const fs = require('fs');
const path = require('path');
const llamaBridge = require('./llama-bridge');

const STATS_FILE = path.join(__dirname, 'knowledge', 'model-stats.json');
let stats = { llamaCalls: 0, claudeCalls: 0, llamaTokens: 0, claudeTokens: 0, history: [] };
try { if (fs.existsSync(STATS_FILE)) stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch (e) {}
function saveStats() { try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); } catch (e) {} }

const FORCE_CLAUDE = /code|debug|architecture|mission|deploy|sécurit|encrypt|algorithm|refactor|analyse.*profond|stratégi|optimis.*complex|concurrent|async|pipeline/i;

async function routeMessage(message, opts = {}) {
  const { complexityScore } = require('./tree-of-thoughts');
  const score = complexityScore(message);
  const forceClaude = FORCE_CLAUDE.test(message) || opts.mode === 'command' || opts.mode === 'mission' || opts.forceOpus;

  let model, reason;
  if (forceClaude || score >= 0.6) {
    model = 'claude'; reason = forceClaude ? 'force_claude_keyword' : 'complexity_high:' + score.toFixed(2);
  } else {
    const llamaOk = await llamaBridge.isOllamaAvailable();
    if (llamaOk && score < 0.6) {
      model = 'llama'; reason = 'complexity_' + (score < 0.3 ? 'low' : 'medium') + ':' + score.toFixed(2);
    } else {
      model = 'claude'; reason = llamaOk ? 'complexity_high' : 'llama_unavailable';
    }
  }

  stats.history.unshift({ ts: new Date().toISOString(), message: message.slice(0, 50), score, model, reason });
  if (stats.history.length > 100) stats.history.pop();
  return { model, score, reason };
}

async function call(message, opts = {}) {
  const { model, score, reason } = await routeMessage(message, opts);

  if (model === 'llama') {
    try {
      const result = await llamaBridge.callLlama(message, opts);
      stats.llamaCalls++;
      stats.llamaTokens += result.tokens || 0;
      if (stats.llamaCalls % 10 === 0) saveStats();
      return { ...result, routedTo: 'llama', score, reason };
    } catch (e) {
      console.warn('[Router] Llama failed, fallback Claude:', e.message);
    }
  }

  const bridge = require('./claude-api-bridge');
  const result = await bridge.call(message, opts);
  stats.claudeCalls++;
  if (stats.claudeCalls % 10 === 0) saveStats();
  return { ...result, routedTo: 'claude', score, reason };
}

function getStats() {
  const total = stats.llamaCalls + stats.claudeCalls;
  return {
    ...stats,
    total,
    llamaPct: total ? Math.round(stats.llamaCalls / total * 100) : 0,
    estimatedSavings: '$' + (stats.llamaCalls * 0.003).toFixed(4),
    ollamaAvailable: null,
  };
}

async function getStatus() {
  const available = await llamaBridge.isOllamaAvailable();
  return { ollamaAvailable: available, model: 'llama3.2:3b', stats: { llamaCalls: stats.llamaCalls, claudeCalls: stats.claudeCalls } };
}

module.exports = { routeMessage, call, getStats, getStatus, isOllamaAvailable: llamaBridge.isOllamaAvailable };
