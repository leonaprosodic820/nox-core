'use strict';
const fs = require('fs');
const path = require('path');
const SUBS_PATH = path.join(__dirname, 'knowledge', 'push-subscriptions.json');

function loadSubs() { try { return JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8')); } catch(e) { return []; } }
function saveSubs(subs) { fs.mkdirSync(path.dirname(SUBS_PATH), { recursive: true }); fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2)); }

function addSubscription(sub) { const subs = loadSubs(); if (!subs.find(s => s.endpoint === sub.endpoint)) { subs.push({ ...sub, createdAt: new Date().toISOString() }); saveSubs(subs); } return { success: true }; }
function removeSubscription(endpoint) { saveSubs(loadSubs().filter(s => s.endpoint !== endpoint)); }

async function sendPush(title, body, opts = {}) {
  const subs = loadSubs();
  if (subs.length === 0) return { sent: 0 };
  try {
    const webpush = require('web-push');
    const cfg = require('./config.json');
    if (!cfg.vapid?.publicKey) { const k = webpush.generateVAPIDKeys(); cfg.vapid = k; fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 2)); }
    webpush.setVapidDetails('mailto:prometheus@omnixai.tech', cfg.vapid.publicKey, cfg.vapid.privateKey);
    const payload = JSON.stringify({ title, body, icon: '/prometheus-logo.svg', tag: opts.tag || 'prometheus' });
    let sent = 0; const failed = [];
    for (const sub of subs) { try { await webpush.sendNotification(sub, payload); sent++; } catch(e) { if (e.statusCode === 410) failed.push(sub.endpoint); } }
    if (failed.length > 0) saveSubs(loadSubs().filter(s => !failed.includes(s.endpoint)));
    return { sent, failed: failed.length };
  } catch(e) { return { sent: 0, error: e.message }; }
}

function getVapidPublicKey() {
  try {
    const cfg = require('./config.json');
    if (cfg.vapid?.publicKey) return cfg.vapid.publicKey;
    const webpush = require('web-push');
    const k = webpush.generateVAPIDKeys();
    const cfgFull = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    cfgFull.vapid = k;
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfgFull, null, 2));
    return k.publicKey;
  } catch(e) { return null; }
}

module.exports = { addSubscription, removeSubscription, sendPush, getVapidPublicKey, getCount: () => loadSubs().length };
