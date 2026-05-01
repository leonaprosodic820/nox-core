'use strict';

const fs = require('fs');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'knowledge', 'prometheus-identity.json');

const TECH_KEYWORDS = [
  'javascript', 'typescript', 'python', 'rust', 'golang', 'react', 'vue', 'angular',
  'node', 'deno', 'bun', 'docker', 'kubernetes', 'terraform', 'ansible',
  'postgres', 'mongodb', 'redis', 'mysql', 'sqlite', 'graphql', 'rest',
  'aws', 'gcp', 'azure', 'cloudflare', 'nginx', 'apache', 'caddy',
  'git', 'ci/cd', 'jenkins', 'github actions', 'tailscale', 'wireguard',
  'nextjs', 'nuxt', 'svelte', 'express', 'fastify', 'hono',
  'linux', 'macos', 'darwin', 'ubuntu', 'debian', 'arch',
  'api', 'websocket', 'grpc', 'mqtt', 'webhook'
];

let identity = null;

function ensureStorage() {
  try {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  } catch (e) { /* ignore */ }
}

function loadIdentity() {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    identity = JSON.parse(raw);
  } catch (e) {
    identity = createDefault();
  }
}

function createDefault() {
  return {
    version: '1.0.0',
    firstContact: new Date().toISOString(),
    totalSessions: 0,
    totalMessages: 0,
    learnedContext: {
      techStack: [],
      communicationStyle: 'neutral',
      expertiseLevel: 'unknown'
    },
    importantDecisions: [],
    knownErrors: []
  };
}

function saveIdentity() {
  try {
    ensureStorage();
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(identity, null, 2));
  } catch (e) { /* ignore */ }
}

function extractTech(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  return TECH_KEYWORDS.filter(kw => lower.includes(kw));
}

function detectStyle(text) {
  if (!text || typeof text !== 'string') return null;
  const len = text.length;
  const hasCode = /```/.test(text);
  const hasEmoji = /[\u{1F600}-\u{1F64F}]/u.test(text);
  const sentences = text.split(/[.!?]+/).filter(Boolean).length;

  if (hasCode && len > 500) return 'technical-detailed';
  if (hasCode) return 'technical-concise';
  if (len < 100 && sentences <= 2) return 'concise';
  if (hasEmoji) return 'casual';
  if (len > 1000) return 'detailed';
  return 'neutral';
}

function detectExpertise(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const advancedTerms = ['kubernetes', 'terraform', 'grpc', 'mutex', 'semaphore', 'syscall',
    'iptables', 'cgroup', 'ebpf', 'wasm', 'simd', 'vtable', 'coroutine'];
  const advCount = advancedTerms.filter(t => lower.includes(t)).length;
  if (advCount >= 3) return 'expert';
  if (advCount >= 1) return 'advanced';

  const techCount = extractTech(text).length;
  if (techCount >= 5) return 'advanced';
  if (techCount >= 2) return 'intermediate';
  return 'beginner';
}

function updateFromConversation(message, response, sessionId) {
  if (!identity) loadIdentity();

  identity.totalMessages++;

  // Track sessions
  if (sessionId && !identity._lastSessionId) {
    identity.totalSessions++;
  } else if (sessionId && identity._lastSessionId !== sessionId) {
    identity.totalSessions++;
  }
  identity._lastSessionId = sessionId;

  // Extract tech from both message and response
  const combined = `${message || ''} ${response || ''}`;
  const newTech = extractTech(combined);
  for (const tech of newTech) {
    if (!identity.learnedContext.techStack.includes(tech)) {
      identity.learnedContext.techStack.push(tech);
    }
  }
  // Cap tech stack
  if (identity.learnedContext.techStack.length > 50) {
    identity.learnedContext.techStack = identity.learnedContext.techStack.slice(-50);
  }

  // Detect style from user messages
  const style = detectStyle(message);
  if (style) identity.learnedContext.communicationStyle = style;

  // Detect expertise
  const expertise = detectExpertise(combined);
  if (expertise) identity.learnedContext.expertiseLevel = expertise;

  // Detect decisions (simple heuristic)
  if (message && /\b(decided|decision|chose|choose|will use|switching to|migrating to)\b/i.test(message)) {
    identity.importantDecisions.push({
      text: message.slice(0, 200),
      timestamp: new Date().toISOString()
    });
    if (identity.importantDecisions.length > 50) {
      identity.importantDecisions = identity.importantDecisions.slice(-50);
    }
  }

  // Detect errors
  if (response && /\b(error|bug|fix|issue|problem|crash|fail)\b/i.test(response)) {
    identity.knownErrors.push({
      text: response.slice(0, 200),
      timestamp: new Date().toISOString()
    });
    if (identity.knownErrors.length > 50) {
      identity.knownErrors = identity.knownErrors.slice(-50);
    }
  }

  identity.lastUpdated = new Date().toISOString();
  saveIdentity();

  return { updated: true, totalMessages: identity.totalMessages, techFound: newTech };
}

function getIdentityContext() {
  if (!identity) loadIdentity();

  const tech = identity.learnedContext.techStack.slice(-10).join(', ') || 'none detected';
  const style = identity.learnedContext.communicationStyle || 'neutral';
  const level = identity.learnedContext.expertiseLevel || 'unknown';
  const sessions = identity.totalSessions || 0;

  let ctx = `User: ${level} level, ${style} style, ${sessions} sessions. Tech: ${tech}.`;
  if (identity.importantDecisions.length > 0) {
    const lastDecision = identity.importantDecisions[identity.importantDecisions.length - 1].text.slice(0, 60);
    ctx += ` Last decision: ${lastDecision}`;
  }

  return ctx.slice(0, 300);
}

function getIdentity() {
  if (!identity) loadIdentity();
  const copy = { ...identity };
  delete copy._lastSessionId;
  return copy;
}

function resetIdentity() {
  identity = createDefault();
  saveIdentity();
  return { reset: true, identity };
}

// Load on require
loadIdentity();

module.exports = { updateFromConversation, getIdentityContext, getIdentity, resetIdentity };
