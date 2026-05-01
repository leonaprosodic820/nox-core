'use strict';
/**
 * PROMETHEUS RAG Engine v9.0
 * Index: emails, documents, notes, code, PDFs, conversations
 * Chunking intelligent + TF-IDF search cross-sources <50ms
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const HOME = os.homedir();
const INDEX_DIR = path.join(__dirname, 'knowledge');
const RAG_FILE = path.join(INDEX_DIR, 'rag-index.json');
fs.mkdirSync(INDEX_DIR, { recursive: true });

const STOPS = new Set('le la les de du des un une et en est a à pour que qui dans ce il ne se pas plus par sur au avec son sa ses the is of to in and for on it that this with was are be'.split(' '));

let index = { docs: [], idf: {}, sources: {}, lastIndexed: null };

function load() { try { if (fs.existsSync(RAG_FILE)) index = JSON.parse(fs.readFileSync(RAG_FILE, 'utf8')); } catch (e) {} }
function save() { index.lastIndexed = new Date().toISOString(); try { fs.writeFileSync(RAG_FILE, JSON.stringify(index)); } catch (e) {} }
load();

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-zàâéèêëïîôûùüç0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOPS.has(w));
}

function tf(tokens) {
  const freq = {};
  tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  const max = Math.max(...Object.values(freq), 1);
  const vec = {};
  Object.entries(freq).forEach(([t, f]) => { vec[t] = f / max; });
  return vec;
}

function recalcIDF() {
  const df = {};
  index.docs.forEach(d => { new Set(Object.keys(d.tf)).forEach(t => { df[t] = (df[t] || 0) + 1; }); });
  const N = index.docs.length || 1;
  index.idf = {};
  Object.entries(df).forEach(([t, f]) => { index.idf[t] = Math.log(N / f); });
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach(k => { const va = a[k] || 0, vb = b[k] || 0; dot += va * vb; na += va * va; nb += vb * vb; });
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function tfidf(vec) {
  const r = {};
  Object.entries(vec).forEach(([t, f]) => { r[t] = f * (index.idf[t] || 1); });
  return r;
}

// Chunking intelligent
function chunk(text, maxLen = 800) {
  const chunks = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  for (const p of paragraphs) {
    if ((current + p).length > maxLen && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += '\n\n' + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

function addDoc(text, source, metadata = {}) {
  const id = crypto.createHash('md5').update(text).digest('hex').slice(0, 12);
  if (index.docs.find(d => d.id === id)) return { id, status: 'duplicate' };
  const tokens = tokenize(text);
  if (tokens.length < 3) return { id, status: 'too_short' };
  index.docs.push({ id, text: text.slice(0, 2000), tf: tf(tokens), source, metadata: { ...metadata, ts: new Date().toISOString() }, tokenCount: tokens.length });
  return { id, status: 'added' };
}

// ── INDEXATION SOURCES ──

function indexConversations() {
  const dir = path.join(__dirname, 'chat-history');
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (let i = 0; i < msgs.length - 1; i += 2) {
        if (msgs[i]?.content && msgs[i + 1]?.content) {
          const text = `[User] ${msgs[i].content}\n[PROMETHEUS] ${msgs[i + 1].content}`;
          const r = addDoc(text, 'conversation', { session: f.replace('.json', '') });
          if (r.status === 'added') count++;
        }
      }
    } catch (e) {}
  });
  return count;
}

function indexDocuments() {
  const dirs = [path.join(HOME, 'Documents'), path.join(HOME, 'Desktop')];
  let count = 0;
  const exts = new Set(['.txt', '.md', '.json', '.csv', '.log', '.sh', '.py', '.js', '.ts', '.html', '.css', '.yml', '.yaml', '.toml', '.cfg', '.conf', '.ini']);

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = execSync(`find "${dir}" -maxdepth 3 -type f -size -500k 2>/dev/null`, { encoding: 'utf8', timeout: 10000 }).trim().split('\n').filter(Boolean);
      for (const file of files.slice(0, 200)) {
        const ext = path.extname(file).toLowerCase();
        if (!exts.has(ext)) continue;
        try {
          const content = fs.readFileSync(file, 'utf8');
          if (content.length < 20) continue;
          const chunks_arr = chunk(content);
          chunks_arr.forEach((c, i) => {
            const r = addDoc(c, 'document', { path: file, chunk: i, filename: path.basename(file) });
            if (r.status === 'added') count++;
          });
        } catch (e) {}
      }
    } catch (e) {}
  }
  return count;
}

function indexCode() {
  const codeDirs = [path.join(HOME, 'claude-relay'), path.join(HOME, 'Projects')].filter(d => fs.existsSync(d));
  let count = 0;
  const codeExts = new Set(['.js', '.ts', '.py', '.sh', '.go', '.rs', '.swift', '.json']);

  for (const dir of codeDirs) {
    try {
      const files = execSync(`find "${dir}" -maxdepth 4 -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.sh" 2>/dev/null | head -100`, { encoding: 'utf8', timeout: 10000 }).trim().split('\n').filter(Boolean);
      for (const file of files) {
        if (/node_modules|\.git|dist|build/.test(file)) continue;
        try {
          const content = fs.readFileSync(file, 'utf8');
          if (content.length < 30) continue;
          // Chunk par fonctions
          const funcChunks = content.split(/\n(?=(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\(|module\.exports))/);
          funcChunks.forEach((c, i) => {
            if (c.trim().length < 20) return;
            const r = addDoc(c.slice(0, 1500), 'code', { path: file, chunk: i, filename: path.basename(file) });
            if (r.status === 'added') count++;
          });
        } catch (e) {}
      }
    } catch (e) {}
  }
  return count;
}

function indexEmails() {
  let count = 0;
  try {
    const script = `tell application "Mail"
  set msgs to messages 1 thru 30 of inbox
  set result to ""
  repeat with m in msgs
    set result to result & "FROM:" & (sender of m) & "|SUBJ:" & (subject of m) & "|DATE:" & (date received of m as string) & "|BODY:" & (content of m as text) & "|||"
  end repeat
  return result
end tell`;
    const out = execSync(`osascript -ss -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', timeout: 30000 });
    const emails = out.split('|||').filter(Boolean);
    emails.forEach(email => {
      const from = email.match(/FROM:([^|]*)/)?.[1] || '';
      const subj = email.match(/SUBJ:([^|]*)/)?.[1] || '';
      const date = email.match(/DATE:([^|]*)/)?.[1] || '';
      const body = email.match(/BODY:([\s\S]*)/)?.[1] || '';
      if (body.length > 20) {
        const text = `Email de ${from}: ${subj}\n${body.slice(0, 1000)}`;
        const r = addDoc(text, 'email', { from, subject: subj, date });
        if (r.status === 'added') count++;
      }
    });
  } catch (e) {}
  return count;
}

function indexNotes() {
  let count = 0;
  try {
    const script = `tell application "Notes"
  set result to ""
  repeat with n in notes 1 thru 20
    set result to result & "TITLE:" & (name of n) & "|BODY:" & (plaintext of n) & "|||"
  end repeat
  return result
end tell`;
    const out = execSync(`osascript -ss -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', timeout: 20000 });
    out.split('|||').filter(Boolean).forEach(note => {
      const title = note.match(/TITLE:([^|]*)/)?.[1] || '';
      const body = note.match(/BODY:([\s\S]*)/)?.[1] || '';
      if (body.length > 20) {
        const r = addDoc(`Note: ${title}\n${body.slice(0, 1500)}`, 'note', { title });
        if (r.status === 'added') count++;
      }
    });
  } catch (e) {}
  return count;
}

// ── RECHERCHE ──

function search(query, opts = {}) {
  const limit = opts.limit || 10;
  const source = opts.source; // filter by source
  const queryVec = tfidf(tf(tokenize(query)));

  return index.docs
    .filter(d => !source || d.source === source)
    .map(d => ({ id: d.id, text: d.text, source: d.source, score: +cosine(queryVec, tfidf(d.tf)).toFixed(4), metadata: d.metadata }))
    .filter(r => r.score > 0.03)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function searchForPrompt(query) {
  const results = search(query, { limit: 3 });
  if (!results.length) return '';
  return '\n[DONNÉES PERSONNELLES RAG]\n' + results.map(r =>
    `[${r.source}] (score:${r.score}) ${r.text.slice(0, 300)}`
  ).join('\n---\n') + '\n[FIN RAG]';
}

// ── INDEX COMPLET ──

async function indexAll() {
  const results = {};
  results.conversations = indexConversations();
  results.documents = indexDocuments();
  results.code = indexCode();
  try { results.emails = indexEmails(); } catch (e) { results.emails = 0; }
  try { results.notes = indexNotes(); } catch (e) { results.notes = 0; }
  recalcIDF();
  save();
  const total = Object.values(results).reduce((s, v) => s + v, 0);
  return { indexed: total, details: results, totalDocs: index.docs.length };
}

function getStats() {
  const bySource = {};
  index.docs.forEach(d => { bySource[d.source] = (bySource[d.source] || 0) + 1; });
  return { totalDocs: index.docs.length, uniqueTerms: Object.keys(index.idf).length, bySource, lastIndexed: index.lastIndexed, sizeKB: Math.round(JSON.stringify(index).length / 1024) };
}

module.exports = { search, searchForPrompt, indexAll, indexConversations, indexDocuments, indexCode, indexEmails, indexNotes, addDoc, getStats, chunk };
