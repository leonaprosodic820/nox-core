const { spawn, execSync } = require('child_process');
const crypto = require('crypto');

let CLAUDE_PATH;
try { CLAUDE_PATH = execSync('which claude 2>/dev/null').toString().trim(); }
catch { CLAUDE_PATH = '/usr/local/bin/claude'; }

const cache = new Map();
const CACHE_TTL = 300000;
const CACHE_MAX = 200;
const stats = { calls: 0, cacheHits: 0, totalMs: 0 };

function getCacheKey(prompt, opts) {
  return crypto.createHash('sha256').update(prompt.slice(0, 500) + (opts.systemPrompt || '').slice(0, 200)).digest('hex').slice(0, 16);
}

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function call(prompt, options = {}) {
  const { systemPrompt = null, maxTokens = 2000, timeoutMs = 60000, useCache = true, model = null } = options;
  stats.calls++;

  if (useCache) {
    const key = getCacheKey(prompt, options);
    const cached = getFromCache(key);
    if (cached) { stats.cacheHits++; return cached; }
  }

  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
  const args = ['-p', '--output-format', 'text'];
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let stdout = '', stderr = '';

    const proc = spawn(CLAUDE_PATH, args, {
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 1000);
      reject(new Error(`Timeout ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdin.write(fullPrompt, 'utf8');
    proc.stdin.end();

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;
      stats.totalMs += elapsed;

      if (code === 0 && stdout.trim()) {
        const result = {
          content: [{ type: 'text', text: stdout.trim() }],
          model: model || 'claude-sonnet-4-6',
          meta: { processingMs: elapsed, cached: false }
        };
        if (useCache && elapsed > 2000) {
          setCache(getCacheKey(prompt, options), result);
        }
        resolve(result);
      } else {
        reject(new Error(`Exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function callFast(prompt, options = {}) {
  return call(prompt, { ...options, maxTokens: 500, timeoutMs: 30000, useCache: true });
}

async function callParallel(prompts, options = {}) {
  return Promise.all(prompts.map(({ prompt, opts }) => call(prompt, { ...options, ...opts })));
}

async function callStreaming(prompt, options = {}, onChunk) {
  const { systemPrompt, timeoutMs = 60000 } = options;
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;

  return new Promise((resolve, reject) => {
    let stdout = '';
    const proc = spawn(CLAUDE_PATH, ['-p', '--output-format', 'text'], {
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, timeoutMs);
    proc.stdin.write(fullPrompt); proc.stdin.end();
    proc.stdout.on('data', chunk => { const t = chunk.toString(); stdout += t; if (onChunk) onChunk(t); });
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ content: [{ type: 'text', text: stdout.trim() }] }) : reject(new Error(`Exit ${code}`)); });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

function parseJSON(response) {
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const strategies = [
    () => JSON.parse(text),
    () => JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()),
    () => JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'),
  ];
  for (const s of strategies) { try { return s(); } catch {} }
  return { text, parseError: true };
}

function isAvailable() {
  try { execSync(`test -x "${CLAUDE_PATH}"`, { timeout: 2000 }); return true; } catch { return false; }
}

function getStats() {
  return { ...stats, cacheSize: cache.size, cacheHitRate: stats.cacheHits / (stats.calls || 1), avgMs: Math.round(stats.totalMs / (stats.calls - stats.cacheHits || 1)) };
}

function clearCache() { cache.clear(); }

async function callWithImage(prompt, base64, mediaType = 'image/jpeg') {
  const fs = require('fs'), path = require('path'), os = require('os');
  const imgPath = path.join(os.tmpdir(), `prom_vision_${Date.now()}.${mediaType.includes('png') ? 'png' : 'jpg'}`);
  fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));
  try {
    const { execSync } = require('child_process');
    const output = execSync(`cat "${imgPath}" | claude -p "${prompt.replace(/"/g, '\\"')}" --output-format text`, { encoding: 'utf8', timeout: 60000 }).trim();
    return { content: [{ type: 'text', text: output }] };
  } catch (e) {
    // Fallback: describe without image
    return await call('L\'utilisateur a envoyé une image. ' + prompt, { maxTokens: 500 });
  } finally { try { fs.unlinkSync(imgPath); } catch (err) {} }
}

module.exports = { call, callFast, callParallel, callStreaming, callWithImage, parseJSON, isAvailable, getStats, clearCache, CLAUDE_PATH };
