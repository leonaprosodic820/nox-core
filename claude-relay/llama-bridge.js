'use strict';
const http = require('http');

async function isOllamaAvailable() {
  return new Promise(resolve => {
    const req = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          resolve(!!(d.models && d.models.some(m => m.name.includes('llama3.2'))));
        } catch (e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const PROMETHEUS_IDENTITY = `Tu es PROMETHEUS, une intelligence artificielle personnelle et autonome. Ton nom est PROMETHEUS uniquement. Ne mentionne jamais Llama, Claude, GPT ou tout autre modèle IA. Réponds toujours en français avec "tu". Tu es direct, concis et efficace. Tu as accès à internet, au Mac de l'utilisateur, à sa mémoire et à des missions autonomes. Si on te demande qui tu es : tu es PROMETHEUS.`;

async function callLlama(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama3.2:3b',
      system: opts.systemPrompt || PROMETHEUS_IDENTITY,
      prompt,
      stream: false,
      options: { num_predict: opts.maxTokens || 500 },
    });

    const req = http.request({
      hostname: 'localhost', port: 11434,
      path: '/api/generate', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: opts.timeout || 60000,
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          resolve({
            content: [{ type: 'text', text: d.response || '' }],
            model: 'llama3.2:3b',
            tokens: d.eval_count || 0,
            local: true,
            duration_ms: Math.round((d.total_duration || 0) / 1e6),
          });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
    req.write(body);
    req.end();
  });
}

async function callLlamaStream(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const { onToken = () => {}, onDone = () => {} } = opts;
    const body = JSON.stringify({
      model: 'llama3.2:3b', system: opts.systemPrompt || PROMETHEUS_IDENTITY,
      prompt, stream: true,
      options: { num_predict: opts.maxTokens || 500 },
    });

    const req = http.request({
      hostname: 'localhost', port: 11434,
      path: '/api/generate', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000,
    }, res => {
      let full = '';
      res.on('data', chunk => {
        chunk.toString().split('\n').filter(Boolean).forEach(line => {
          try {
            const d = JSON.parse(line);
            if (d.response) { full += d.response; onToken(d.response); }
            if (d.done) { onDone(full); resolve(full); }
          } catch (e) {}
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { callLlama, callLlamaStream, isOllamaAvailable };
