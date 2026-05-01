'use strict';

const fs = require('fs');
const path = require('path');

const COMPRESS_DIR = path.join(__dirname, 'knowledge', 'compressed');
fs.mkdirSync(COMPRESS_DIR, { recursive: true });

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

async function compressHistory(history, opts = {}) {
  const bridge = require('./claude-api-bridge');
  const maxKeep = opts.keepLast || 5;
  if (!history || history.length === 0) return { compressed: [], summary: '' };

  const recent = history.slice(-maxKeep);
  const toCompress = history.slice(0, -maxKeep);
  if (toCompress.length === 0) return { compressed: recent, summary: '' };

  const histText = toCompress.map(m => `[${m.role?.toUpperCase() || 'USER'}]: ${m.content}`).join('\n\n');
  const resp = await bridge.callFast(
    `Resume cette conversation de facon dense. Garde TOUS les faits importants, decisions, code, fichiers crees. Concis.\n\nCONVERSATION:\n${histText.slice(0, 200000)}`,
    { maxTokens: 8000 }
  );
  const summary = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';

  return {
    compressed: [{ role: 'user', content: `[CONTEXTE COMPRESSE — ${toCompress.length} messages]\n\n${summary}`, compressed: true, originalCount: toCompress.length, compressedAt: new Date().toISOString() }, ...recent],
    summary,
    savedTokens: estimateTokens(histText) - estimateTokens(summary),
  };
}

async function compressMissionResults(results, opts = {}) {
  const bridge = require('./claude-api-bridge');
  if (!results || results.length === 0) return { compressed: [], summary: '' };

  const keepLast = opts.keepLast || 5;
  const recent = results.slice(-keepLast);
  const old = results.slice(0, -keepLast);
  if (old.length === 0) return { compressed: recent, summary: '' };

  const oldText = old.map(r => `Etape ${r.stepId}: ${r.title}\n${r.summary}\n${(r.output || '').slice(0, 500)}`).join('\n\n---\n\n');
  const resp = await bridge.callFast(
    `Resume ces resultats de mission. Garde fichiers crees, code, decisions. Liste bullet concise.\n\n${oldText.slice(0, 100000)}`,
    { maxTokens: 4000 }
  );
  const summary = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';

  return {
    compressed: [{ stepId: 'compressed', title: `Resume (${old.length} etapes)`, summary, output: summary, compressed: true }, ...recent],
    summary,
    savedTokens: estimateTokens(oldText) - estimateTokens(summary),
  };
}

function slidingWindow(history, maxTokens = 800000) {
  if (!history || history.length === 0) return [];
  let total = 0;
  const result = [];
  const first = history[0];
  const firstTokens = estimateTokens(first.content);

  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content);
    if (total + tokens > maxTokens - firstTokens) break;
    result.unshift(history[i]);
    total += tokens;
  }

  if (result[0] !== first) {
    result.unshift({ ...first, content: '[CONTEXTE INITIAL]\n' + first.content.slice(0, 5000) });
  }
  return result;
}

module.exports = { estimateTokens, compressHistory, compressMissionResults, slidingWindow };
