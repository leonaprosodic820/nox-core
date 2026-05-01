'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHROMA_PORT = 8765;
const FALLBACK_FILE = path.join(__dirname, 'knowledge', 'episodic-fallback.json');
fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });

async function isChromaAvailable() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${CHROMA_PORT}/health`, { timeout: 2000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).ok === true); } catch (e) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function chromaCall(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: 'localhost', port: CHROMA_PORT, path: endpoint, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data || '') },
      timeout: 5000,
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Chroma timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

let fallback = [];
function loadFallback() { try { if (fs.existsSync(FALLBACK_FILE)) fallback = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch (e) {} }
function saveFallback() { try { if (fallback.length > 10000) fallback = fallback.slice(-8000); fs.writeFileSync(FALLBACK_FILE, JSON.stringify(fallback)); } catch (e) {} }
loadFallback();

function tfidfSearch(query, mems, n = 5) {
  const qw = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return mems.map(m => {
    const t = (m.text || '').toLowerCase();
    const score = qw.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0) / (qw.length || 1);
    return { ...m, score };
  }).filter(m => m.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
}

async function addEpisode(episode) {
  const id = crypto.randomUUID();
  const doc = {
    text: (episode.text || episode.content || '').slice(0, 2000),
    metadata: {
      sessionId: episode.sessionId || 'unknown', role: episode.role || 'user',
      timestamp: episode.timestamp || new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
    },
    id,
  };
  fallback.push({ id, ...doc });
  if (fallback.length % 50 === 0) saveFallback();
  if (await isChromaAvailable()) { try { await chromaCall('/add', 'POST', doc); } catch (e) {} }
  return id;
}

async function searchEpisodes(query, opts = {}) {
  const n = opts.n || 5;
  if (await isChromaAvailable()) {
    try {
      const r = await chromaCall('/search', 'POST', { query, n, filter: opts.filter || null });
      const docs = r.documents?.[0] || [], metas = r.metadatas?.[0] || [], dists = r.distances?.[0] || [];
      const results = docs.map((text, i) => ({ text, metadata: metas[i], relevance: +(1 - (dists[i] || 0)).toFixed(4), source: 'chromadb' })).filter(r => r.relevance > 0.3);
      if (results.length) return results;
    } catch (e) {}
  }
  return tfidfSearch(query, fallback, n).map(m => ({ text: m.text, metadata: m.metadata, relevance: m.score, source: 'fallback' }));
}

async function indexAllHistory() {
  const chatDir = path.join(__dirname, 'chat-history');
  if (!fs.existsSync(chatDir)) return { indexed: 0 };
  let count = 0;
  const existingIds = new Set(fallback.map(m => m.id));
  fs.readdirSync(chatDir).filter(f => f.endsWith('.json')).forEach(f => {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(chatDir, f), 'utf8'));
      (Array.isArray(msgs) ? msgs : []).forEach(msg => {
        if (!msg.content || msg.content.length < 20) return;
        const hash = crypto.createHash('md5').update(msg.content).digest('hex').slice(0, 12);
        if (existingIds.has(hash)) return;
        fallback.push({ id: hash, text: msg.content.slice(0, 2000), metadata: { sessionId: f.replace('.json', ''), role: msg.role || 'user', date: new Date(msg.ts || Date.now()).toISOString().slice(0, 10) } });
        existingIds.add(hash);
        count++;
      });
    } catch (e) {}
  });
  saveFallback();
  return { indexed: count, total: fallback.length };
}

async function getStats() {
  let chromaCount = 0, chromaOk = await isChromaAvailable();
  if (chromaOk) try { chromaCount = (await chromaCall('/count', 'GET')).count || 0; } catch (e) {}
  return { chromadb: { available: chromaOk, episodes: chromaCount }, fallback: { episodes: fallback.length }, total: Math.max(chromaCount, fallback.length) };
}

async function getRelevantContext(message, n = 3) {
  const results = await searchEpisodes(message, { n });
  if (!results.length) return '';
  return '[MÉMOIRE ÉPISODIQUE]\n' + results.map(r => `[${r.metadata?.date || '?'}] ${r.text.slice(0, 200)}`).join('\n') + '\n[FIN MÉMOIRE]';
}

setTimeout(() => { indexAllHistory().catch(() => {}); }, 5000);

module.exports = { addEpisode, searchEpisodes, indexAllHistory, getStats, getRelevantContext, isChromaAvailable };
