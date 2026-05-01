'use strict';
/**
 * PROMETHEUS Vector Memory v8.0
 * Recherche sémantique locale — TF-IDF + cosine similarity
 * Indexe conversations, décisions, contexte projet
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_DIR = path.join(__dirname, 'knowledge');
const INDEX_FILE = path.join(MEMORY_DIR, 'vector-index.json');
fs.mkdirSync(MEMORY_DIR, { recursive: true });

let index = { documents: [], idf: {}, docCount: 0, lastUpdated: null };

function load() {
  try { if (fs.existsSync(INDEX_FILE)) index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (e) {}
}
function save() {
  index.lastUpdated = new Date().toISOString();
  try { fs.writeFileSync(INDEX_FILE, JSON.stringify(index)); } catch (e) {}
}
load();

// Tokenization FR/EN
function tokenize(text) {
  const stops = new Set(['le','la','les','de','du','des','un','une','et','en','est','a','à','pour',
    'que','qui','dans','ce','il','ne','se','pas','plus','par','sur','au','avec','son','sa','ses',
    'the','is','a','an','of','to','in','and','for','on','it','that','this','with','was','are','be']);
  return text.toLowerCase()
    .replace(/[^a-zàâéèêëïîôûùüç0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stops.has(w));
}

// TF vector pour un document
function tf(tokens) {
  const freq = {};
  tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  const max = Math.max(...Object.values(freq), 1);
  const vec = {};
  Object.entries(freq).forEach(([t, f]) => { vec[t] = f / max; });
  return vec;
}

// Recalculer IDF
function recalcIDF() {
  const df = {};
  index.documents.forEach(doc => {
    const seen = new Set(Object.keys(doc.tf));
    seen.forEach(t => { df[t] = (df[t] || 0) + 1; });
  });
  const N = index.documents.length || 1;
  index.idf = {};
  Object.entries(df).forEach(([t, f]) => { index.idf[t] = Math.log(N / f); });
}

// Cosine similarity
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach(k => {
    const va = a[k] || 0, vb = b[k] || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  });
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// TF-IDF vector
function tfidf(tfVec) {
  const vec = {};
  Object.entries(tfVec).forEach(([t, f]) => {
    vec[t] = f * (index.idf[t] || 1);
  });
  return vec;
}

// ── API PUBLIQUE ──

function addDocument(text, metadata = {}) {
  const id = crypto.createHash('md5').update(text).digest('hex').slice(0, 12);
  const exists = index.documents.find(d => d.id === id);
  if (exists) return { id, status: 'duplicate' };

  const tokens = tokenize(text);
  if (tokens.length < 3) return { id, status: 'too_short' };

  const doc = {
    id,
    text: text.slice(0, 2000),
    tf: tf(tokens),
    metadata: { ...metadata, ts: new Date().toISOString() },
    tokenCount: tokens.length,
  };

  index.documents.push(doc);
  index.docCount = index.documents.length;
  recalcIDF();

  if (index.documents.length % 20 === 0) save();
  return { id, status: 'added', tokenCount: tokens.length };
}

function search(query, opts = {}) {
  const limit = opts.limit || 10;
  const minScore = opts.minScore || 0.05;
  const after = opts.after ? new Date(opts.after).getTime() : 0;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const queryTF = tf(queryTokens);
  const queryVec = tfidf(queryTF);

  let results = index.documents
    .filter(doc => {
      if (after && new Date(doc.metadata.ts).getTime() < after) return false;
      if (opts.type && doc.metadata.type !== opts.type) return false;
      if (opts.session && doc.metadata.session !== opts.session) return false;
      return true;
    })
    .map(doc => {
      const docVec = tfidf(doc.tf);
      const score = cosine(queryVec, docVec);
      return { id: doc.id, text: doc.text, score: +score.toFixed(4), metadata: doc.metadata };
    })
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

function indexConversation(sessionId, userMsg, assistantMsg) {
  const combined = `[User] ${userMsg}\n[PROMETHEUS] ${assistantMsg}`;
  return addDocument(combined, { type: 'conversation', session: sessionId, role: 'exchange' });
}

function indexDecision(decision, context) {
  return addDocument(`Décision: ${decision}\nContexte: ${context}`, { type: 'decision' });
}

function findRelated(query, opts = {}) {
  return search(query, { limit: opts.limit || 5, minScore: 0.1, ...opts });
}

function getStats() {
  return {
    documents: index.docCount,
    uniqueTerms: Object.keys(index.idf).length,
    lastUpdated: index.lastUpdated,
    sizeKB: Math.round(JSON.stringify(index).length / 1024),
  };
}

function clear() {
  index = { documents: [], idf: {}, docCount: 0, lastUpdated: null };
  save();
}

function flush() { save(); }

// Indexer l'historique existant
function indexExistingHistory() {
  const chatDir = path.join(__dirname, 'chat-history');
  if (!fs.existsSync(chatDir)) return { indexed: 0 };
  let count = 0;
  try {
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.json'));
    files.forEach(f => {
      try {
        const msgs = JSON.parse(fs.readFileSync(path.join(chatDir, f), 'utf8'));
        for (let i = 0; i < msgs.length - 1; i++) {
          if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
            const r = indexConversation(f.replace('.json', ''), msgs[i].content, msgs[i + 1].content);
            if (r.status === 'added') count++;
          }
        }
      } catch (e) {}
    });
    save();
  } catch (e) {}
  return { indexed: count };
}

module.exports = {
  addDocument, search, indexConversation, indexDecision,
  findRelated, getStats, clear, flush, indexExistingHistory,
};
