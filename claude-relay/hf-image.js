'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getToken() { try { return require('./config.json').huggingface?.token; } catch (e) { return null; } }

const MODELS = { photo: 'black-forest-labs/FLUX.1-schnell', art: 'black-forest-labs/FLUX.1-dev', logo: 'black-forest-labs/FLUX.1-schnell', fast: 'black-forest-labs/FLUX.1-schnell' };

async function generate(prompt, opts = {}) {
  const token = getToken();
  if (!token) return { error: 'Token HF manquant — ajouter dans config.json: huggingface.token' };
  const model = MODELS[opts.type] || MODELS.fast;
  const outputPath = path.join(os.tmpdir(), `hf_img_${Date.now()}.png`);
  const body = JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: opts.steps || 4, width: opts.width || 1024, height: opts.height || 1024 } });

  return new Promise(resolve => {
    const req = https.request({ hostname: 'api-inference.huggingface.co', path: `/models/${model}`, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-wait-for-model': 'true' }, timeout: 90000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ error: `HF ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}` });
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(outputPath, buf);
        resolve({ success: true, path: outputPath, prompt, model });
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout — modèle HF en chargement, réessaie' }); });
    req.write(body); req.end();
  });
}

async function enhancePrompt(userPrompt, type = 'photo') {
  try {
    const bridge = require('./claude-api-bridge');
    const styles = { photo: 'photorealistic, high quality, 8k', art: 'digital art, vibrant illustration', logo: 'minimalist, clean, vector style' };
    const resp = await bridge.callFast(`Améliore ce prompt pour FLUX.1 image gen. Style: ${styles[type] || styles.photo}. Réponds UNIQUEMENT avec le prompt amélioré.\nPrompt: "${userPrompt}"`, { maxTokens: 100 });
    return (typeof resp === 'string' ? resp : resp.content?.[0]?.text || userPrompt).trim();
  } catch (e) { return userPrompt; }
}

module.exports = { generate, enhancePrompt, MODELS };
