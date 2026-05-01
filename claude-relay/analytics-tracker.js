'use strict';
const fs = require('fs');
const path = require('path');

const ANALYTICS_FILE = path.join(__dirname, 'metrics', 'analytics.json');
fs.mkdirSync(path.dirname(ANALYTICS_FILE), { recursive: true });

function today() { return new Date().toISOString().slice(0, 10); }
function thisWeek() { const d = new Date(); d.setDate(d.getDate() - (d.getDay() || 7) + 1); return d.toISOString().slice(0, 10); }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

let data = {
  daily: {}, weekly: {}, monthly: {},
  total: { tokens: 0, sessions: 0, decisions: 0, chats: 0, webFetches: 0, screenshots: 0, commands: 0 },
  perf: { lastUpdated: null },
  costs: { totalUSD: 0 },
  sessions: [],
  hourly: {},
};

function load() { try { if (fs.existsSync(ANALYTICS_FILE)) data = { ...data, ...JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')) }; } catch (e) {} }
function save() { data.perf.lastUpdated = new Date().toISOString(); try { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }
load();

function track(event, meta = {}) {
  const d = today(), w = thisWeek(), m = thisMonth(), h = new Date().getHours();
  if (!data.daily[d]) data.daily[d] = { tokens: 0, sessions: 0, chats: 0, decisions: 0, webFetches: 0, commands: 0, screenshots: 0, responseMs: [] };
  if (!data.weekly[w]) data.weekly[w] = { tokens: 0, sessions: 0, chats: 0, decisions: 0 };
  if (!data.monthly[m]) data.monthly[m] = { tokens: 0, sessions: 0, chats: 0, decisions: 0 };
  if (!data.hourly[d]) data.hourly[d] = Array(24).fill(0);

  switch (event) {
    case 'token': {
      const n = meta.count || 0;
      data.daily[d].tokens += n; data.weekly[w].tokens += n; data.monthly[m].tokens += n;
      data.total.tokens += n; data.costs.totalUSD += n * 0.000003;
      break;
    }
    case 'chat':
      data.daily[d].chats++; data.weekly[w].chats++; data.monthly[m].chats++; data.total.chats++;
      data.hourly[d][h]++;
      if (meta.responseMs) data.daily[d].responseMs.push(meta.responseMs);
      break;
    case 'session_created':
      data.daily[d].sessions++; data.weekly[w].sessions++; data.monthly[m].sessions++; data.total.sessions++;
      data.sessions.push({ id: meta.id, name: meta.name, ts: new Date().toISOString() });
      if (data.sessions.length > 100) data.sessions.shift();
      break;
    case 'decision':
      data.daily[d].decisions++; data.weekly[w].decisions++; data.monthly[m].decisions++; data.total.decisions++;
      break;
    case 'web_fetch': data.daily[d].webFetches = (data.daily[d].webFetches || 0) + 1; data.total.webFetches++; break;
    case 'screenshot': data.daily[d].screenshots = (data.daily[d].screenshots || 0) + 1; data.total.screenshots++; break;
    case 'command': data.daily[d].commands = (data.daily[d].commands || 0) + 1; data.total.commands++; break;
  }
  if ((data.total.chats + data.total.commands) % 10 === 0) save();
}

function getReport() {
  save();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const dd = data.daily[key] || { tokens: 0, chats: 0, sessions: 0, decisions: 0, webFetches: 0, responseMs: [] };
    days.push({
      date: key, label: dt.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
      ...dd,
      avgResponseMs: dd.responseMs?.length ? Math.round(dd.responseMs.reduce((a, b) => a + b, 0) / dd.responseMs.length) : 0,
    });
  }
  const todayHourly = data.hourly[today()] || Array(24).fill(0);
  return {
    total: data.total, costs: { totalUSD: data.costs.totalUSD.toFixed(4) },
    today: data.daily[today()] || {}, thisWeek: data.weekly[thisWeek()] || {}, thisMonth: data.monthly[thisMonth()] || {},
    days30: days, hourly: todayHourly,
    peakHour: todayHourly.indexOf(Math.max(...todayHourly)),
    recentSessions: data.sessions.slice(-10).reverse(),
  };
}

module.exports = { track, getReport };
