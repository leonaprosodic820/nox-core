const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEMPLATES = {
  omega: (input, ctx) => {
    const ctxStr = smartTruncate(ctx, 150);
    const inputStr = typeof input === 'string' ? input.slice(0, 500) : JSON.stringify(input).slice(0, 500);
    return `Relay IA. Decide action for this input.\nCtx: ${ctxStr}\nInput: ${inputStr}\nAction: send_to_claude_code|choose_option|answer_question|retry_with_fix|mark_complete|wait\nJSON:{"decision":{"action":"...","reasoning":"1phrase","confidence":0-100},"payload":{"value":"..."}}`;
  },

  enhance: (prompt, ctx) =>
    `Improve this Claude Code prompt. Stack: ${(ctx?.techStack || ['Node.js']).join(',')}\nPrompt: ${prompt.slice(0, 500)}\nReturn ONLY the improved prompt between [CC_START] and [CC_END].`,

  analyze: (result, request) =>
    `Evaluate Claude Code result.\nRequest: ${(request || '').slice(0, 250)}\nResult: ${(result || '').slice(0, 500)}\nJSON:{"score":0-100,"ok":true,"issues":[],"next":"continue|fix|complete","fix":"if next=fix"}`,

  strategy: (objective, phase, progress) =>
    `Phase:${phase} Progress:${progress}% Objective:${(objective || '').slice(0, 250)}\nJSON:{"nextStep":"...","risks":["..."],"estimatedIterations":N}`,

  prometheus: (objective, ctx, risks) =>
    `Mission: ${(objective || '').slice(0, 350)}\nCtx: ${smartTruncate(ctx, 100)}\nPlan JSON:{"phases":[{"name":"...","steps":[{"action":"...","target":"claude_code|mac|local","prompt":"..."}]}],"confidence":0-100}`,

  improve: (stats) =>
    `Stats: ${JSON.stringify(stats).slice(0, 350)}\nJSON:{"insights":["..."],"recommendations":["..."],"adjustments":{"minQuality":N}}`,

  heal: (error, context) =>
    `Error: ${(typeof error === 'string' ? error : error?.message || '').slice(0, 250)}\nJSON:{"cause":"...","fix":"...","command":"shell or null","canAutoHeal":true}`,
};

function smartTruncate(context, maxTokens = 300) {
  const maxChars = maxTokens * 4;
  if (!context || typeof context !== 'object') return String(context || '').slice(0, maxChars);

  const parts = [
    context.currentTask ? `T:${context.currentTask}` : null,
    context.objective ? `O:${context.objective}` : null,
    context.techStack?.length ? `S:${context.techStack.join(',')}` : null,
    context.name ? `P:${context.name}` : null,
    context.lastError ? `E:${context.lastError}` : null,
  ].filter(Boolean);

  let result = '';
  for (const p of parts) {
    if ((result + p).length < maxChars) result += (result ? '|' : '') + p;
    else break;
  }
  return result;
}

function compressHistory(iterations = [], maxTokens = 200) {
  if (!iterations.length) return '';
  return iterations.slice(-5).map(it =>
    `[${it.index}:${(it.analysisType || '?').slice(0, 4)}]`
  ).join('').slice(0, maxTokens * 4);
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 3.7);
}

function detectComplexity(input) {
  const len = (input || '').length;
  if (len > 1000 || /```/.test(input)) return 'complex';
  if (len > 400 || /error|Error/i.test(input)) return 'medium';
  return 'simple';
}

const MAX_TOKENS_MAP = {
  omega: 400, omega_complex: 700,
  enhance: 500, enhance_complex: 900,
  analyze: 300, strategy: 250,
  prometheus: 1200, heal: 300,
  improve: 400, confirm: 50
};

function getOptimalMaxTokens(type, complexity = 'simple') {
  return MAX_TOKENS_MAP[`${type}_${complexity}`] || MAX_TOKENS_MAP[type] || 400;
}

// Semantic cache
const semanticCache = new Map();
const SEMANTIC_TTL = 300000;
const SEMANTIC_MAX = 150;

function semanticKey(text) {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(w => w.length > 3).sort().slice(0, 15).join('|');
  return crypto.createHash('md5').update(words).digest('hex').slice(0, 12);
}

function getCachedSemantic(text) {
  const key = semanticKey(text);
  const entry = semanticCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SEMANTIC_TTL) { semanticCache.delete(key); return null; }
  entry.hits++;
  return entry.response;
}

function setCachedSemantic(text, response) {
  if (semanticCache.size >= SEMANTIC_MAX) {
    const oldest = semanticCache.keys().next().value;
    semanticCache.delete(oldest);
  }
  semanticCache.set(semanticKey(text), { response, ts: Date.now(), hits: 0 });
}

// Budget manager
class TokenBudgetManager {
  constructor(dailyBudget = 500000) {
    this.dailyBudget = dailyBudget;
    this.used = { input: 0, output: 0, calls: 0 };
    this.resetTime = this.nextMidnight();
    this.saved = 0;
  }

  nextMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }

  track(inputTokens, outputTokens) {
    if (Date.now() > this.resetTime) { this.used = { input: 0, output: 0, calls: 0 }; this.resetTime = this.nextMidnight(); }
    this.used.input += inputTokens;
    this.used.output += outputTokens;
    this.used.calls++;
  }

  trackSaved(tokens) { this.saved += tokens; }

  getStats() {
    const total = this.used.input + this.used.output;
    return {
      calls: this.used.calls, inputTokens: this.used.input, outputTokens: this.used.output,
      totalTokens: total, tokensSaved: this.saved,
      budgetUsedPercent: Math.round(total / this.dailyBudget * 100),
      avgTokensPerCall: this.used.calls > 0 ? Math.round(total / this.used.calls) : 0,
      estimatedCost: '$' + (total * 0.000003).toFixed(4)
    };
  }
}

const budgetManager = new TokenBudgetManager();

async function optimizedCall(bridge, templateName, templateArgs, options = {}) {
  const template = TEMPLATES[templateName];
  if (!template) throw new Error(`Unknown template: ${templateName}`);

  const prompt = template(...templateArgs);

  // Semantic cache check
  if (options.useCache !== false) {
    const cached = getCachedSemantic(prompt);
    if (cached) {
      budgetManager.trackSaved(estimateTokens(prompt));
      return cached;
    }
  }

  const complexity = detectComplexity(prompt);
  const maxTokens = options.maxTokens || getOptimalMaxTokens(templateName, complexity);
  const inputEst = estimateTokens(prompt);

  const response = await bridge.call(prompt, { ...options, maxTokens });

  const outputEst = estimateTokens(response.content?.[0]?.text || '');
  budgetManager.track(inputEst, outputEst);

  if (options.useCache !== false) setCachedSemantic(prompt, response);

  return response;
}

async function batchProcess(bridge, items, processor, options = {}) {
  const { batchSize = 5 } = options;
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const prompt = `Process ${batch.length} items:\n${batch.map((item, idx) => `[${idx}] ${JSON.stringify(item).slice(0, 200)}`).join('\n')}\nJSON:{"results":[{"id":0,"result":"..."}]}`;
    const response = await bridge.call(prompt, { maxTokens: Math.min(300 * batch.length, 2000) });
    const parsed = bridge.parseJSON(response);
    if (parsed.results) results.push(...parsed.results);
  }
  return results;
}

module.exports = {
  TEMPLATES, smartTruncate, compressHistory, estimateTokens, detectComplexity,
  getOptimalMaxTokens, optimizedCall, batchProcess, budgetManager,
  semanticKey, getCachedSemantic, setCachedSemantic, semanticCache,
  TokenBudgetManager
};
