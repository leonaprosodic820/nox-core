'use strict';

const fs = require('fs');
const path = require('path');

let lastTree = null;

const TECH_WORDS = [
  'api', 'server', 'database', 'docker', 'kubernetes', 'deploy', 'nginx',
  'ssl', 'tls', 'auth', 'token', 'jwt', 'oauth', 'webhook', 'websocket',
  'redis', 'postgres', 'mongodb', 'graphql', 'rest', 'microservice',
  'ci/cd', 'pipeline', 'terraform', 'ansible', 'cloudflare', 'dns',
  'firewall', 'proxy', 'load balancer', 'cache', 'queue', 'worker',
  'encryption', 'hash', 'certificate', 'container', 'cluster', 'node',
  'typescript', 'javascript', 'python', 'rust', 'golang', 'react', 'vue',
  'algorithm', 'architecture', 'scalability', 'latency', 'throughput'
];

function complexityScore(msg) {
  if (!msg || typeof msg !== 'string') return 0;
  let score = 0;
  if (msg.length > 40) score += 0.15;
  if (msg.length > 80) score += 0.15;
  if (msg.length > 150) score += 0.1;
  if (/\?/.test(msg)) score += 0.1;
  // Multi-keyword bonus
  const complex = /analyse|compare|stratégie|risque|architecture|debug|optimis|amélio|refactor|décide|choisir|meilleur|que faire|expliqu|problème|solution/gi;
  const matches = (msg.match(complex) || []).length;
  if (matches >= 1) score += 0.2;
  if (matches >= 2) score += 0.2;
  if (/comment|pourquoi|why|how/i.test(msg)) score += 0.1;
  if (/si.*alors|quand.*alors|ou bien|versus|vs\b/i.test(msg)) score += 0.15;
  return Math.min(score, 1.0);
}

function getLastTree() {
  return lastTree;
}

async function thinkInTrees(question, context, opts = {}) {
  try {
    const { callFast } = require('./claude-api-bridge');

    const systemPrompt = `You are a strategic thinker. Given a question and context, generate exactly 3 different approaches to answer it.
Return ONLY valid JSON in this format:
{
  "approaches": [
    { "name": "approach name", "description": "brief description", "answer": "the answer using this approach", "coherence": 0.8, "feasibility": 0.7, "risk": 0.2 },
    { "name": "approach name", "description": "brief description", "answer": "the answer using this approach", "coherence": 0.8, "feasibility": 0.7, "risk": 0.2 },
    { "name": "approach name", "description": "brief description", "answer": "the answer using this approach", "coherence": 0.8, "feasibility": 0.7, "risk": 0.2 }
  ]
}
Each score is 0-1. Be honest in scoring.`;

    const prompt = context
      ? `Context: ${context}\n\nQuestion: ${question}`
      : `Question: ${question}`;

    const raw = await callFast(prompt, {
      systemPrompt,
      maxTokens: opts.maxTokens || 3000,
      timeoutMs: opts.timeoutMs || 45000
    });

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      parsed = null;
    }

    if (!parsed || !Array.isArray(parsed.approaches) || parsed.approaches.length === 0) {
      const fallback = {
        question,
        approaches: [{ name: 'direct', description: 'Direct answer', answer: raw, score: 0.5 }],
        bestApproach: { name: 'direct', answer: raw, score: 0.5 },
        finalAnswer: raw,
        timestamp: new Date().toISOString()
      };
      lastTree = fallback;
      return fallback;
    }

    const scored = parsed.approaches.map(a => ({
      ...a,
      score: (a.coherence || 0.5) * 0.4 + (a.feasibility || 0.5) * 0.4 - (a.risk || 0.5) * 0.2
    }));

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    const tree = {
      question,
      approaches: scored,
      bestApproach: { name: best.name, answer: best.answer, score: best.score },
      finalAnswer: best.answer,
      timestamp: new Date().toISOString()
    };

    lastTree = tree;
    return tree;
  } catch (err) {
    const errorResult = {
      question,
      error: err.message,
      approaches: [],
      bestApproach: null,
      finalAnswer: null,
      timestamp: new Date().toISOString()
    };
    lastTree = errorResult;
    return errorResult;
  }
}

module.exports = { thinkInTrees, complexityScore, getLastTree };
