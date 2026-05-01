'use strict';
const http = require('http');

function localFetch(path, timeout = 5000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port: 7777, path, timeout }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function detectNeeds(message) {
  const m = message.toLowerCase();
  return {
    needsWeather:  /météo|meteo|température|temps.*aujourd|vent|pluie/i.test(m),
    needsCrypto:   /bitcoin|ethereum|btc|eth|crypto|prix.*token/i.test(m),
    needsNews:     /actualit|news|aujourd.*info|dernier.*nouvelles/i.test(m),
    needsSport:    /classement|ligue|score|match|foot|résultat.*sport/i.test(m),
    needsWebSearch:/recherche|cherche|trouve|info.*sur/i.test(m),
    needsRAG:      /rappelle|souviens|projet|avant|dernier.*fois|on.*avait/i.test(m),
    needsMac:      /mon mac|cpu|ram|batterie|processus/i.test(m),
    needsVPS:      /vps|serveur.*status/i.test(m),
    isQuestion:    message.includes('?'),
    isUrgent:      /urgent|vite|maintenant/i.test(m),
  };
}

async function run(message, history, sessionId) {
  const needs = detectNeeds(message);
  const ctx = { web: [], memory: [], system: [], static: [] };
  const t0 = Date.now();
  const tasks = [];

  if (needs.needsWeather) {
    tasks.push(async () => {
      const city = message.match(/(?:à|de|pour)\s+([A-Za-zÀ-ÿ]{2,20})/i)?.[1] || 'Paris';
      const r = await localFetch('/web/weather?city=' + encodeURIComponent(city));
      if (r?.current) ctx.web.push('[Météo ' + (r.city||city) + '] ' + r.current.temp_c + '°C, ' + (r.current.description||'') + ', Humidité ' + r.current.humidity + '%, Vent ' + (r.current.wind_kmh||'?') + ' km/h');
    });
  }
  if (needs.needsCrypto) {
    tasks.push(async () => {
      const r = await localFetch('/web/crypto?coins=bitcoin,ethereum');
      const coins = Array.isArray(r) ? r : r?.coins;
      if (coins?.length) ctx.web.push('[Crypto] ' + coins.map(c => c.name + ': ' + c.price_eur + '€ (' + (c.change_24h||'?') + ')').join(' | '));
    });
  }
  if (needs.needsNews || needs.needsSport || needs.needsWebSearch) {
    tasks.push(async () => {
      try {
        const bc = require('./browser-control');
        const r = await Promise.race([bc.webSearch(message), new Promise(res => setTimeout(() => res(null), 8000))]);
        if (r?.success && r.answer) ctx.web.push('[Web] ' + r.answer.slice(0, 500));
      } catch(e) {}
    });
  }
  if (needs.needsMac) {
    tasks.push(async () => {
      const r = await localFetch('/monitor/realtime', 4000);
      if (r) ctx.system.push('[Mac] CPU:' + r.cpu + '% RAM:' + r.ram + '% Disque:' + r.disk + '%' + (r.battery ? ' Bat:' + r.battery + '%' : ''));
    });
  }

  await Promise.allSettled(tasks.map(t => t()));

  try { const sc = require('./session-context'); const c = sc.buildCrossSessionContext(sessionId); if (c) ctx.static.push(c); } catch(e) {}
  try { const cm = require('./cognitive-module'); const c = cm.buildContext(); if (c) ctx.static.push(c); } catch(e) {}
  try { const ltm = require('./long-term-memory'); const c = ltm.buildLTMContext(); if (c) ctx.static.push(c); } catch(e) {}
  try { const em = require('./empathy-engine'); const c = em.buildEmpathyContext(message); if (c) ctx.static.push(c); } catch(e) {}
  try { const ic = require('./identity-core'); const c = ic.buildIdentityContext(); if (c) ctx.static.push(c); } catch(e) {}

  const context = [...ctx.web, ...ctx.memory, ...ctx.system, ...ctx.static].filter(Boolean).join('\n');
  return { context, needs, timing: { total: Date.now() - t0 }, sources: { web: ctx.web.length, memory: ctx.memory.length, system: ctx.system.length, static: ctx.static.length } };
}

function recordFeedback(message, response, pipeline, routedTo) {
  try {
    const si = require('./self-improvement');
    const quality = si.analyzeResponseQuality(message, response);
    const rl = require('./reinforcement-learning');
    rl.learn(message, routedTo, routedTo, quality, pipeline?.timing?.total || 0);
    setImmediate(() => { try { require('./knowledge-graph').extractFromConversation(message, response); } catch(e) {} });
    setImmediate(() => { try { require('./long-term-memory').extractAndStore(message, response); } catch(e) {} });
    return quality;
  } catch(e) { return null; }
}

module.exports = { run, detectNeeds, recordFeedback };
