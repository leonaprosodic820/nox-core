'use strict';
/**
 * PROMETHEUS Temporal Consciousness v9.0
 * Daemon 24/7 — scan emails, crypto, downloads, weather, news
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const LOG_FILE = path.join(__dirname, 'knowledge', 'temporal-log.json');
const CONFIG_FILE = path.join(__dirname, 'knowledge', 'temporal-config.json');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

let log = { events: [], briefs: [], lastScan: null };
let config = {
  cryptoThresholds: { bitcoin: { above: 100000, below: 50000 }, ethereum: { above: 5000, below: 2000 } },
  scanIntervalMin: 15,
  briefHour: 8,
  watchDownloads: true,
  watchEmails: true,
  watchCrypto: true,
  watchWeather: true,
  watchNews: true,
};
let running = false;
let intervals = [];

function loadLog() { try { if (fs.existsSync(LOG_FILE)) log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (e) {} }
function saveLog() { try { fs.writeFileSync(LOG_FILE, JSON.stringify(log)); } catch (e) {} }
function loadConfig() { try { if (fs.existsSync(CONFIG_FILE)) config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch (e) {} }
function saveConfig() { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {} }
loadLog(); loadConfig();

function addEvent(type, data) {
  log.events.push({ type, data, ts: new Date().toISOString() });
  if (log.events.length > 500) log.events = log.events.slice(-300);
  if (log.events.length % 5 === 0) saveLog();
}

// ── SCANNERS ──

async function scanCrypto() {
  if (!config.watchCrypto) return;
  try {
    const webIntel = require('./web-intelligence');
    const data = await webIntel.getCrypto(['bitcoin', 'ethereum']);
    const coins = data.coins || data;
    if (!Array.isArray(coins)) return;

    coins.forEach(coin => {
      const id = coin.id || coin.name?.toLowerCase();
      const price = coin.price_usd || coin.current_price;
      const threshold = config.cryptoThresholds[id];
      if (threshold && price) {
        if (price > threshold.above) {
          addEvent('crypto_alert', { coin: id, price, alert: 'above_threshold', threshold: threshold.above });
        } else if (price < threshold.below) {
          addEvent('crypto_alert', { coin: id, price, alert: 'below_threshold', threshold: threshold.below });
        }
      }
      addEvent('crypto_price', { coin: id, price, change24h: coin.change_24h || coin.price_change_percentage_24h });
    });
  } catch (e) {}
}

async function scanDownloads() {
  if (!config.watchDownloads) return;
  const dlDir = path.join(os.homedir(), 'Downloads');
  try {
    const recent = execSync(`find "${dlDir}" -maxdepth 1 -type f -mmin -15 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim().split('\n').filter(Boolean);
    recent.forEach(f => {
      const name = path.basename(f);
      const stat = fs.statSync(f);
      addEvent('new_download', { filename: name, size: stat.size, path: f });
    });
  } catch (e) {}
}

async function scanEmails() {
  if (!config.watchEmails) return;
  try {
    const script = `tell application "Mail" to return count of (messages of inbox whose read status is false)`;
    const count = parseInt(execSync(`osascript -e '${script}'`, { encoding: 'utf8', timeout: 10000 }).trim());
    if (count > 0) addEvent('unread_emails', { count });
  } catch (e) {}
}

async function scanWeather() {
  if (!config.watchWeather) return;
  try {
    const webIntel = require('./web-intelligence');
    const w = await webIntel.getWeather('Paris');
    const current = w.current || {};
    if (current.temp_c > 35) addEvent('weather_alert', { type: 'extreme_heat', temp: current.temp_c });
    else if (current.temp_c < -5) addEvent('weather_alert', { type: 'extreme_cold', temp: current.temp_c });
    addEvent('weather_check', { city: w.city, temp: current.temp_c, description: current.description });
  } catch (e) {}
}

async function scanNews() {
  if (!config.watchNews) return;
  try {
    const webIntel = require('./web-intelligence');
    const news = await webIntel.getNews('monde', { limit: 5 });
    const articles = news.articles || [];
    const breaking = articles.filter(a => /urgent|breaking|alerte|flash/i.test(a.title));
    if (breaking.length) addEvent('breaking_news', { articles: breaking.map(a => ({ title: a.title, url: a.url })) });
  } catch (e) {}
}

// ── SCAN COMPLET ──

async function fullScan() {
  log.lastScan = new Date().toISOString();
  await Promise.allSettled([scanCrypto(), scanDownloads(), scanEmails(), scanWeather(), scanNews()]);
  saveLog();
}

// ── BRIEF MATINAL ──

async function generateBrief() {
  const now = new Date();
  const yesterday = new Date(now - 86400000);
  const recentEvents = log.events.filter(e => new Date(e.ts) > yesterday);

  const sections = [];

  // Crypto
  const cryptoEvents = recentEvents.filter(e => e.type === 'crypto_price').slice(-2);
  if (cryptoEvents.length) {
    sections.push('## Crypto\n' + cryptoEvents.map(e => `- ${e.data.coin}: $${e.data.price} (${e.data.change24h || '?'})`).join('\n'));
  }

  // Downloads
  const downloads = recentEvents.filter(e => e.type === 'new_download');
  if (downloads.length) {
    sections.push(`## Downloads (${downloads.length} nouveaux)\n` + downloads.slice(-5).map(e => `- ${e.data.filename}`).join('\n'));
  }

  // Emails
  const emailEvents = recentEvents.filter(e => e.type === 'unread_emails').slice(-1);
  if (emailEvents.length) {
    sections.push(`## Emails\n- ${emailEvents[0].data.count} non lus`);
  }

  // Weather
  const weatherEvents = recentEvents.filter(e => e.type === 'weather_check').slice(-1);
  if (weatherEvents.length) {
    const w = weatherEvents[0].data;
    sections.push(`## Météo\n- ${w.city}: ${w.temp}°C — ${w.description}`);
  }

  // Alerts
  const alerts = recentEvents.filter(e => e.type.includes('alert'));
  if (alerts.length) {
    sections.push('## Alertes\n' + alerts.map(e => `- [${e.type}] ${JSON.stringify(e.data).slice(0, 100)}`).join('\n'));
  }

  const brief = {
    date: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    eventCount: recentEvents.length,
    content: `# Brief PROMETHEUS — ${now.toLocaleDateString('fr-FR')}\n\n` + (sections.join('\n\n') || 'Aucun événement notable.'),
  };

  log.briefs.push(brief);
  if (log.briefs.length > 30) log.briefs.shift();
  saveLog();
  return brief;
}

// ── DAEMON ──

function start() {
  if (running) return { status: 'already_running' };
  running = true;
  console.log(`[Temporal] Daemon started — scan every ${config.scanIntervalMin}min`);

  // Scan immédiat
  fullScan();

  // Scan toutes les X minutes
  const scanInterval = setInterval(fullScan, config.scanIntervalMin * 60 * 1000);
  scanInterval.unref();
  intervals.push(scanInterval);

  // Brief matinal
  const briefInterval = setInterval(() => {
    const h = new Date().getHours();
    if (h === config.briefHour) generateBrief();
  }, 3600000);
  briefInterval.unref();
  intervals.push(briefInterval);

  return { status: 'started', scanIntervalMin: config.scanIntervalMin };
}

function stop() {
  running = false;
  intervals.forEach(i => clearInterval(i));
  intervals = [];
  return { status: 'stopped' };
}

function getStatus() { return { running, lastScan: log.lastScan, eventCount: log.events.length, briefCount: log.briefs.length }; }
function getEvents(limit = 50) { return log.events.slice(-limit).reverse(); }
function getBriefs() { return log.briefs.slice(-10).reverse(); }
function getLatestBrief() { return log.briefs[log.briefs.length - 1] || null; }
function getConfig() { return config; }
function updateConfig(updates) { Object.assign(config, updates); saveConfig(); return config; }

module.exports = { start, stop, fullScan, generateBrief, getStatus, getEvents, getBriefs, getLatestBrief, getConfig, updateConfig };
