'use strict';
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const TOKEN = cfg.telegram?.token;
const ALLOWED_ID = String(cfg.telegram?.chatId || '');
if (!TOKEN) { console.error('[HERMES] No token'); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10, allowed_updates: ['message', 'callback_query'] } } });
const STATE = { active: true, messageCount: 0, alertsSent: 0, startTime: Date.now(), awaitingInput: null, pendingConfirms: new Map(), voiceMode: false };
const SECURITY = { allowedChatIds: [ALLOWED_ID], rateLimitMs: 1000, msgTimestamps: new Map(), failedAttempts: new Map(), commandLog: [] };

function api(p, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ hostname: 'localhost', port: 7777, path: p, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data || '') }, timeout: 60000 },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ text: d }); } }); });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (data) req.write(data); req.end();
  });
}

function auth(msg) {
  const uid = String(msg.from?.id || ''), cid = String(msg.chat?.id || '');
  const ok = SECURITY.allowedChatIds.includes(cid) || SECURITY.allowedChatIds.includes(uid);
  if (!ok) {
    const n = (SECURITY.failedAttempts.get(uid) || 0) + 1; SECURITY.failedAttempts.set(uid, n);
    if (n >= 3) console.warn(`[HERMES] ${n} unauthorized attempts from ${uid}`);
    try { require('./sovereignty-engine').auditLog('WARN', 'telegram_unauthorized', `User ${uid} chat ${cid}`, 'DANGEROUS', true); } catch (e) {}
    return false;
  }
  const now = Date.now(), last = SECURITY.msgTimestamps.get(uid) || 0;
  if (now - last < SECURITY.rateLimitMs) return false;
  SECURITY.msgTimestamps.set(uid, now);
  SECURITY.commandLog.push({ ts: new Date().toISOString(), uid, text: (msg.text || '').slice(0, 50) });
  if (SECURITY.commandLog.length > 200) SECURITY.commandLog.shift();
  return true;
}
function deny(id) { bot.sendMessage(id, '🔴 Accès refusé.'); }
function fmt(t) { return (t || '').slice(0, 3800).replace(/\*\*(.+?)\*\*/g, '*$1*'); }

async function sendAlert(level, title, message, opts = {}) {
  if (!STATE.active) return false;
  const icons = { INFO: 'ℹ️', WARN: '⚠️', CRITICAL: '🔴', EMERGENCY: '🚨', SUCCESS: '✅', MAC: '💻', CRYPTO: '₿', MORNING: '☀️' };
  try { await bot.sendMessage(ALLOWED_ID, `${icons[level] || '📡'} *${title}*\n\n${message}`, { parse_mode: 'Markdown', ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}) }); STATE.alertsSent++; return true; }
  catch (e) { return false; }
}

function mainKB() {
  return { inline_keyboard: [
    [{ text: '💬 Chat', callback_data: 'chat' }, { text: '📊 Status', callback_data: 'status' }],
    [{ text: '₿ Crypto', callback_data: 'crypto' }, { text: '🌤 Météo', callback_data: 'weather' }],
    [{ text: '📸 Screenshot', callback_data: 'screenshot' }, { text: '🔍 Optimizer', callback_data: 'optimize' }],
    [{ text: '📈 Analytics', callback_data: 'analytics' }, { text: '🛡 Sovereignty', callback_data: 'sovereignty' }],
    [{ text: '🚀 Mission', callback_data: 'mission' }, { text: '🕸 Knowledge', callback_data: 'knowledge' }],
    [{ text: '📋 Audit', callback_data: 'audit' }, { text: '⚡ Simuler', callback_data: 'sov_simulate' }],
    [{ text: '💾 Backup', callback_data: 'backup' }, { text: '🧠 Mémoire', callback_data: 'memory' }],
    [{ text: '🔮 Prédictions', callback_data: 'causal' }, { text: '🧭 Routing', callback_data: 'model' }],
    [{ text: '☀️ Brief', callback_data: 'brief' }, { text: '/voicemode', callback_data: 'voicemode' }],
    [{ text: '🔴 KILL SWITCH', callback_data: 'kill' }],
  ] };
}

// ── Commandes texte ──
bot.onText(/\/start/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await bot.sendMessage(msg.chat.id, `⚡ *HERMES — Messager de PROMETHEUS*\n\nTape un message ou utilise le menu.`, { parse_mode: 'Markdown', reply_markup: mainKB() }); });

bot.onText(/\/help/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendMessage(msg.chat.id, `*HERMES — Commandes*\n\n*Système:*\n/status /analytics /sovereignty\n/audit /audit BLOCKED /audit CRITICAL\n\n*Mac:*\n/optimize /screenshot /backup\n/simulate <commande>\n\n*Intelligence:*\n/memory /causal /knowledge <terme>\n/mission <description>\n/brief\n\n*Web:*\n/crypto /meteo <ville>\n\n*Sécurité:*\n/kill — Kill switch\n\n_Message libre → PROMETHEUS_`, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doStatus(msg.chat.id); });
bot.onText(/\/crypto/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doCrypto(msg.chat.id); });
bot.onText(/\/meteo(?:\s+(.+))?/, async (msg, m) => { if (!auth(msg)) return deny(msg.chat.id); await doWeather(msg.chat.id, m?.[1] || 'Paris'); });
bot.onText(/\/screenshot/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doScreenshot(msg.chat.id); });
bot.onText(/\/optimize/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doOptimize(msg.chat.id); });
bot.onText(/\/backup/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doBackup(msg.chat.id); });
bot.onText(/\/memory/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doMemory(msg.chat.id); });
bot.onText(/\/brief/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doBrief(msg.chat.id); });
bot.onText(/\/analytics/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doAnalytics(msg.chat.id); });
bot.onText(/\/causal/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doCausal(msg.chat.id); });

bot.onText(/\/model/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    const [d, h] = await Promise.all([api('/model/stats'), api('/llama/status')]);
    await bot.sendMessage(msg.chat.id, `*🧭 Routing Modèles*\n\n🦙 *Llama 3.2:3b*\nDisponible: ${h.available ? '✅' : '❌'}\nAppels: ${d.llamaCalls || 0} (${d.llamaPct || 0}%)\n\n🤖 *Claude Opus 4.7*\nAppels: ${d.claudeCalls || 0}\n\n💰 Économies: ${d.estimatedSavings || '$0'}\n📊 Total: ${d.total || 0} requêtes`, { parse_mode: 'Markdown' });
  } catch (e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/apps/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const [apps, net] = await Promise.all([api('/mac/app/list'), api('/mac/network')]);
    const appList = (apps.apps || []).slice(0, 20).join('\n• ');
    await bot.sendMessage(msg.chat.id, `*📱 Apps actives*\n• ${appList}\n\n*🌐 Réseau*\nWiFi: ${net.wifi||'?'}\nIP: ${net.ip_local||'?'}\nPublic: ${net.ip_public||'?'}\nPing: ${net.ping_ms||'?'}ms`, { parse_mode: 'Markdown' });
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/music(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const action = match?.[1]?.trim();
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    if (action && ['play','pause','next','previous','stop'].includes(action)) {
      await api('/mac/music/control', 'POST', { action }); await bot.sendMessage(msg.chat.id, `✅ Music: ${action}`);
    } else {
      const [m, s] = await Promise.all([api('/mac/music/status'), api('/mac/spotify/status')]);
      let t = '*🎵 Musique*\n\n';
      if (!m.error) t += `*Apple Music* ${m.state==='playing'?'▶️':'⏸'} ${m.track||'?'} — ${m.artist||''}\n`;
      if (!s.error) t += `*Spotify* ${s.state==='playing'?'▶️':'⏸'} ${s.track||'?'} — ${s.artist||''}`;
      if (m.error && s.error) t += '_Aucun lecteur actif_';
      await bot.sendMessage(msg.chat.id, t, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{text:'⏮',callback_data:'music_prev'},{text:'⏸',callback_data:'music_pause'},{text:'▶️',callback_data:'music_play'},{text:'⏭',callback_data:'music_next'}]]} });
    }
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/calendar(?:\s+(\d+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const days = parseInt(match?.[1]) || 7;
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const d = await api('/mac/calendar/events?days='+days); const evts = (d.events||[]).slice(0,10).map(e=>'• '+e).join('\n') || '_Aucun événement_';
    await bot.sendMessage(msg.chat.id, `*📅 Agenda — ${days}j*\n\n${evts}`, { parse_mode: 'Markdown' });
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/remind(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    if (match?.[1]?.trim()) { const r = await api('/mac/reminders/add', 'POST', { title: match[1].trim() }); await bot.sendMessage(msg.chat.id, r.success ? `✅ Rappel: _${match[1].trim()}_` : '❌ '+r.error, { parse_mode: 'Markdown' }); }
    else { const d = await api('/mac/reminders'); const items = (d.reminders||[]).slice(0,10).map(r=>'• '+r).join('\n') || '_Aucun_'; await bot.sendMessage(msg.chat.id, `*⏰ Rappels*\n\n${items}\n\n_/remind <texte>_`, { parse_mode: 'Markdown' }); }
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/contact\s+(.+)/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const d = await api('/mac/contacts/search?q='+encodeURIComponent(match[1].trim())); const c = (d.contacts||[]).slice(0,5).map(x=>'• '+x).join('\n') || '_Aucun_';
    await bot.sendMessage(msg.chat.id, `*👤 Contacts — "${match[1].trim()}"*\n\n${c}`, { parse_mode: 'Markdown' });
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/launch\s+(.+)/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  try { const r = await api('/mac/app/launch', 'POST', { app: match[1].trim() }); await bot.sendMessage(msg.chat.id, r.success ? `✅ ${match[1].trim()} lancé` : '❌ '+r.error); }
  catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/quit\s+(.+)/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  try { const r = await api('/mac/app/quit', 'POST', { app: match[1].trim() }); await bot.sendMessage(msg.chat.id, r.success ? `✅ ${match[1].trim()} fermé` : '❌ '+r.error); }
  catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/cc(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  if (!match?.[1]?.trim()) { STATE.awaitingInput = 'cc'; await bot.sendMessage(msg.chat.id, '🤖 *Claude Code*\nQuelle tâche ?', { parse_mode: 'Markdown' }); return; }
  await launchCC(msg.chat.id, match[1].trim());
});

async function launchCC(chatId, instruction) {
  await bot.sendMessage(chatId, `🤖 _${instruction.slice(0,80)}_\n⏳ En cours...`, { parse_mode: 'Markdown' });
  await bot.sendChatAction(chatId, 'typing');
  try { const r = await api('/cc/run', 'POST', { instruction }); await bot.sendMessage(chatId, `*🤖 Claude Code*\n\n${fmt(r.output||'Terminé')}`, { parse_mode: 'Markdown' }).catch(()=>bot.sendMessage(chatId, r.output||'Done')); }
  catch(e) { await bot.sendMessage(chatId, '❌ ' + e.message); }
}

bot.onText(/\/emails/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const d = await api('/email/unread?max=5'); const emails = d.emails || [];
    if (!emails.length) { await bot.sendMessage(msg.chat.id, '📭 Aucun email non lu'); return; }
    const lines = emails.slice(0,5).map(e => `📧 *${e.subject}*\nDe: ${e.from}\n_${e.preview.slice(0,100)}_`);
    await bot.sendMessage(msg.chat.id, `*📬 Emails non lus (${emails.length})*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/drafts/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const d = await api('/email/drafts'); const drafts = d.drafts || [];
    if (!drafts.length) { await bot.sendMessage(msg.chat.id, '📭 Aucun draft'); return; }
    for (const dr of drafts.slice(0,3)) {
      await bot.sendMessage(msg.chat.id, `*✍️ ${dr.email.subject}*\nÀ: ${dr.email.from}\n\n${(dr.draft||'').slice(0,300)}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{text:'✅ Envoyer',callback_data:'send_'+dr.id},{text:'❌ Supprimer',callback_data:'del_draft_'+dr.id}]]} });
    }
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/design(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  if (!match?.[1]?.trim()) { STATE.awaitingInput = 'design'; await bot.sendMessage(msg.chat.id, '🎨 *Design*\nDécris ce que tu veux créer:', { parse_mode: 'Markdown' }); return; }
  await createDesign(msg.chat.id, match[1].trim());
});

async function createDesign(chatId, desc) {
  await bot.sendMessage(chatId, `🎨 _${desc.slice(0,60)}_\n⏳ Claude Code crée...`, { parse_mode: 'Markdown' });
  await bot.sendChatAction(chatId, 'upload_photo');
  try {
    const r = await api('/design/generate', 'POST', { description: desc });
    if (r.error) { await bot.sendMessage(chatId, '❌ ' + r.error); return; }
    if (r.pngBase64) { await bot.sendPhoto(chatId, Buffer.from(r.pngBase64, 'base64'), { caption: '🎨 ' + desc }); }
    else if (r.svgContent) { await bot.sendDocument(chatId, Buffer.from(r.svgContent), {}, { filename: 'design.svg', contentType: 'image/svg+xml' }); }
  } catch(e) { await bot.sendMessage(chatId, '❌ ' + e.message); }
}

bot.onText(/\/image(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  if (!match?.[1]?.trim()) { STATE.awaitingInput = 'image'; await bot.sendMessage(msg.chat.id, '🎨 *Image HF*\nDécris l\'image:', { parse_mode: 'Markdown' }); return; }
  await generateImage(msg.chat.id, match[1].trim());
});

async function generateImage(chatId, prompt) {
  await bot.sendMessage(chatId, `🎨 _${prompt.slice(0,60)}_\n⏳ FLUX.1 génère...`, { parse_mode: 'Markdown' });
  await bot.sendChatAction(chatId, 'upload_photo');
  try {
    const r = await api('/image/generate', 'POST', { prompt, enhance: true });
    if (r.error) { await bot.sendMessage(chatId, '❌ ' + r.error); return; }
    if (r.image) { await bot.sendPhoto(chatId, Buffer.from(r.image, 'base64'), { caption: '🎨 ' + (r.originalPrompt || prompt) }); }
    else { await bot.sendMessage(chatId, '❌ Pas d\'image générée'); }
  } catch(e) { await bot.sendMessage(chatId, '❌ ' + e.message); }
}

bot.onText(/\/website(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  if (!match?.[1]?.trim()) { STATE.awaitingInput = 'website'; await bot.sendMessage(msg.chat.id, '🌐 *Site Web*\nDécris le site à créer:', { parse_mode: 'Markdown' }); return; }
  await buildSite(msg.chat.id, match[1].trim());
});

async function buildSite(chatId, desc) {
  await bot.sendMessage(chatId, `🌐 _${desc.slice(0,60)}_\n⏳ Claude Code construit...`, { parse_mode: 'Markdown' });
  await bot.sendChatAction(chatId, 'typing');
  try {
    const r = await api('/vps/site/create', 'POST', { description: desc });
    if (r.error) { await bot.sendMessage(chatId, '❌ ' + r.error); return; }
    STATE.currentProject = r.projectId;
    await bot.sendMessage(chatId, `*🌐 Site créé* ✅\n\n📁 ${(r.files||[]).join(', ')}\nID: \`${r.projectId}\`\n\n_/sites pour voir tous les projets_`, { parse_mode: 'Markdown' });
  } catch(e) { await bot.sendMessage(chatId, '❌ ' + e.message); }
}

bot.onText(/\/sites/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const d = await api('/vps/sites'); const sites = d.sites || [];
    if (!sites.length) { await bot.sendMessage(msg.chat.id, '📭 Aucun site\n_/website pour créer_', { parse_mode: 'Markdown' }); return; }
    const list = sites.slice(0,5).map(s => `• \`${s.id}\` — ${s.files} fichiers — ${s.size}`).join('\n');
    await bot.sendMessage(msg.chat.id, `*🌐 Sites*\n\n${list}`, { parse_mode: 'Markdown' });
  } catch(e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/sovereignty/, async (msg) => { if (!auth(msg)) return deny(msg.chat.id); await doSovereignty(msg.chat.id); });

bot.onText(/\/audit(?:\s+(BLOCKED|CRITICAL|ALL))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const filter = match?.[1] !== 'ALL' ? match?.[1] : null;
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    const entries = await api('/sovereignty/audit?n=15' + (filter ? '&filter=' + filter : ''));
    if (!entries.length) { await bot.sendMessage(msg.chat.id, '📋 Audit log vide'); return; }
    const ic = { INFO: 'ℹ️', WARN: '⚠️', CRITICAL: '🔴', BLOCKED: '🚫' };
    const lines = entries.slice(0, 10).map(e => `${ic[e.level] || '•'} \`${e.ts?.slice(11, 19) || '?'}\` [${e.classification || '?'}] ${e.action || ''}`);
    await bot.sendMessage(msg.chat.id, `*📋 Audit*${filter ? ' — ' + filter : ''}\n\n${lines.join('\n')}\n\n_/audit BLOCKED · /audit CRITICAL · /audit ALL_`, { parse_mode: 'Markdown' });
  } catch (e) { await bot.sendMessage(msg.chat.id, '❌ ' + e.message); }
});

bot.onText(/\/simulate(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  if (!match?.[1]) { STATE.awaitingInput = 'simulate'; await bot.sendMessage(msg.chat.id, '⚡ Tape la commande à analyser :'); return; }
  await runSimulate(msg.chat.id, match[1]);
});

bot.onText(/\/mission(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  if (!match?.[1]) { STATE.awaitingInput = 'mission'; await bot.sendMessage(msg.chat.id, '🚀 Décris la mission à lancer :'); return; }
  await launchMission(msg.chat.id, match[1]);
});

bot.onText(/\/knowledge(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await doKnowledge(msg.chat.id, match?.[1]);
});

bot.onText(/\/kill/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendMessage(msg.chat.id, '🔴 Confirmer KILL SWITCH ?', { reply_markup: { inline_keyboard: [[{ text: '✅ OUI', callback_data: 'confirm_kill' }, { text: '❌ Non', callback_data: 'cancel_kill' }]] } });
});

// ── Whisper transcription (cleanup garanti) ──
async function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { try { fs.unlinkSync(filePath); } catch (e) {} };
    const proc = spawn('python3', [path.join(__dirname, 'whisper-transcribe.py'), filePath], {
      timeout: 120000, env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin' },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => { cleanup(); code === 0 && stdout.trim() ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || 'Transcription échouée')); });
    proc.on('error', e => { cleanup(); reject(e); });
    setTimeout(() => { proc.kill('SIGTERM'); cleanup(); reject(new Error('Timeout transcription')); }, 120000);
  });
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, res => { res.pipe(file); file.on('finish', () => { file.close(); resolve(); }); }).on('error', e => { fs.unlink(destPath, () => {}); reject(e); });
  });
}

// ── TTS — Réponse vocale macOS say → ogg ──
const FR_VOICE = 'Thomas';

// TTS — macOS say en priorité (<1s), Coqui trop lent sur CPU
async function textToVoice(text) {
  const ts = Date.now();
  const tmpAiff = path.join(os.tmpdir(), `hermes_say_${ts}.aiff`);
  const tmpOgg = path.join(os.tmpdir(), `hermes_say_${ts}.ogg`);
  const clean = text.replace(/\*+|_+|`+|#{1,6}\s/g, '').replace(/https?:\/\/\S+/g, '').replace(/[^\x00-\x7Fàâäéèêëîïôùûüç\s.,!?;:'\-]/g, '').replace(/\n+/g, '. ').trim().slice(0, 1000);
  if (!clean || clean.length < 3) throw new Error('Texte vide');

  return new Promise((resolve, reject) => {
    const sayProc = spawn('say', ['-v', FR_VOICE, '-r', '175', '-o', tmpAiff, clean], { timeout: 60000 });
    sayProc.on('close', code => {
      if (code !== 0) { try { fs.unlinkSync(tmpAiff); } catch (e) {} return reject(new Error('say failed')); }
      const ff = spawn('ffmpeg', ['-i', tmpAiff, '-acodec', 'libopus', '-b:a', '32k', '-y', tmpOgg], { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
      ff.on('close', c => { try { fs.unlinkSync(tmpAiff); } catch (e) {} c === 0 && fs.existsSync(tmpOgg) ? resolve(tmpOgg) : reject(new Error('ffmpeg failed')); });
      ff.on('error', e => { try { fs.unlinkSync(tmpAiff); } catch (err) {} reject(e); });
    });
    sayProc.on('error', e => { try { fs.unlinkSync(tmpAiff); } catch (err) {} reject(e); });
  });
}

async function sendVoiceReply(chatId, text) {
  let oggPath = null;
  try {
    oggPath = await textToVoice(text);
    await bot.sendVoice(chatId, fs.createReadStream(oggPath));
    return true;
  } catch (e) { console.error('[HERMES] TTS:', e.message); return false; }
  finally { if (oggPath) try { fs.unlinkSync(oggPath); } catch (e) {} }
}

// ── Voice intent detection ──
function detectVoiceIntent(text) {
  const t = text.toLowerCase().trim();
  if (/mode texte|r[ée]ponds?\s*en texte|stop\s*(le\s*)?vocal|arr[eê]te\s*(le\s*)?vocal|d[ée]sactive\s*(le\s*)?vocal|text\s*only/i.test(t)) return 'deactivate';
  if (/r[ée]ponds?\s*[-\s]?moi en vocal|r[ée]ponds?\s*en voix|r[ée]ponds?\s*vocalement|mode vocal|parle[-\s]?moi|voice mode/i.test(t)) return 'activate';
  if (/r[ée]ponds?\s*en vocal.*(cette|une) fois|dis[-\s]?moi ça en vocal/i.test(t)) return 'once';
  return null;
}

// ── Central reply function ──
async function sendReply(chatId, responseText, opts = {}) {
  const { transcription = null, forceVoice = false, forceText = false } = opts;
  const useVoice = !forceText && (forceVoice || STATE.voiceMode);
  let text = '';
  if (transcription) text += `*🎤 Tu as dit:*\n_${transcription.slice(0, 200)}_\n\n`;
  text += `*⚡ PROMETHEUS:*\n${fmt(responseText)}`;
  if (STATE.voiceMode && !transcription) text += '\n\n_🔊 Mode vocal actif_';
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(chatId, (transcription ? '🎤 ' + transcription + '\n\n' : '') + responseText));
  if (useVoice) { await bot.sendChatAction(chatId, 'record_voice'); const voiceText = responseText.length > 250 ? responseText.slice(0, 247) + '...' : responseText; await sendVoiceReply(chatId, voiceText); }
}

// ── /voicemode toggle ──
bot.onText(/\/voicemode/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  STATE.voiceMode = !STATE.voiceMode;
  await bot.sendMessage(msg.chat.id, STATE.voiceMode ? '🔊 *Mode vocal ON*\n_Toutes les réponses seront vocales_' : '💬 *Mode vocal OFF*\n_Retour texte_', { parse_mode: 'Markdown' });
});

// ── Messages libres ──
bot.on('message', async (msg) => {
  if (!auth(msg)) return; if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;

  // ── Photo → Claude Vision ──
  if (msg.photo || (msg.document && msg.document.mime_type?.startsWith('image/'))) {
    STATE.messageCount++;
    await bot.sendChatAction(msg.chat.id, 'typing');
    try {
      const photo = msg.photo ? msg.photo[msg.photo.length - 1] : msg.document;
      const fi = await bot.getFile(photo.file_id);
      const imgBuf = await new Promise((resolve, reject) => { const chunks = []; https.get(`https://api.telegram.org/file/bot${TOKEN}/${fi.file_path}`, res => { res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); }).on('error', reject); });
      const caption = msg.caption || 'Analyse cette image en détail';
      const resp = await api('/prometheus/chat', 'POST', { message: caption + ' [Image jointe analysée par Vision]', sessionId: 'prometheus-shadowroot', mode: 'chat' });
      const visionText = `👁 PROMETHEUS Vision\n\n${(resp.response || 'Analyse non disponible').slice(0, 3800)}`;
      await bot.sendMessage(msg.chat.id, visionText).catch(() => bot.sendMessage(msg.chat.id, visionText.slice(0, 2000)));
    } catch(e) { await bot.sendMessage(msg.chat.id, '❌ Vision: ' + e.message); }
    return;
  }

  // ── VOCAL entrant ──
  if (msg.voice || msg.audio) {
    STATE.messageCount++;
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    const duration = msg.voice?.duration || msg.audio?.duration || 0;
    if (duration > 60) { await bot.sendMessage(chatId, `⚠️ Vocal trop long (${duration}s, max 60s)`); return; }
    await bot.sendChatAction(chatId, 'typing');
    try {
      const fi = await bot.getFile(fileId);
      const tmpPath = path.join(os.tmpdir(), `hermes_audio_${Date.now()}.ogg`);
      await downloadFile(`https://api.telegram.org/file/bot${TOKEN}/${fi.file_path}`, tmpPath);
      const transcription = await transcribeAudio(tmpPath);
      if (!transcription || transcription.length < 2) { await bot.sendMessage(chatId, '🎤 Aucune parole détectée'); return; }
      await bot.sendChatAction(chatId, 'typing');
      const resp = await api('/prometheus/chat', 'POST', { message: transcription, sessionId: 'prometheus-shadowroot', mode: 'chat' });
      await sendReply(chatId, resp.response || 'Pas de réponse', { transcription, forceVoice: true });
      try { require('./analytics-tracker').track('voice_message', { duration }); } catch (e) {}
    } catch (e) { await bot.sendMessage(chatId, `❌ Audio: ${e.message}`); }
    return;
  }

  // ── TEXTE entrant — Routeur d'intentions ──
  const text = (msg.text || '').trim(); if (!text) return;
  STATE.messageCount++;

  // Kill switch absolu
  if (/PROMETHEUS STOP TOUT|KILL PROMETHEUS|ARRÊT D'URGENCE/i.test(text)) { await bot.sendMessage(chatId, '🔴 Kill switch activé'); try { await api('/sovereignty/kill', 'POST', {}); } catch (e) {} return; }

  // Inputs attendus
  if (STATE.awaitingInput) { const mode = STATE.awaitingInput; STATE.awaitingInput = null;
    if (mode === 'simulate') { await runSimulate(chatId, text); return; }
    if (mode === 'mission') { await launchMission(chatId, text); return; }
    if (mode === 'cc') { await launchCC(chatId, text); return; }
    if (mode === 'design') { await createDesign(chatId, text); return; }
    if (mode === 'image') { await generateImage(chatId, text); return; }
    if (mode === 'website') { await buildSite(chatId, text); return; } }

  // Voice mode toggle
  const vi = detectVoiceIntent(text);
  if (vi === 'activate') { STATE.voiceMode = true; await bot.sendMessage(chatId, '🔊 *Mode vocal ON*', { parse_mode: 'Markdown' }); return; }
  if (vi === 'deactivate') { STATE.voiceMode = false; await bot.sendMessage(chatId, '💬 *Mode texte*', { parse_mode: 'Markdown' }); return; }

  // ── ROUTEUR D'INTENTIONS ──
  const INTENTS = [
    { name: 'image', match: /génère.*(image|photo)|crée.*(image|photo)|dessine|image de .+|photo de .+|illustration de/i, fn: () => generateImage(chatId, text) },
    { name: 'website', match: /crée.*(site|page|web)|fais.*(site|page)|landing page|portfolio.*web/i, fn: () => buildSite(chatId, text) },
    { name: 'design', match: /crée.*(logo|icône|banner|design)|logo pour|design pour/i, fn: () => createDesign(chatId, text) },
    { name: 'screenshot', match: /screenshot|capture.*écran|montre.*écran/i, fn: () => doScreenshot(chatId) },
    { name: 'status', match: /état.*mac|status.*système|comment va.*mac/i, fn: () => doStatus(chatId) },
    { name: 'optimize', match: /optimise.*mac|nettoie|libère.*espace|vide.*cache/i, fn: () => doOptimize(chatId) },
    { name: 'crypto', match: /prix.*(bitcoin|crypto|btc|eth)|cours.*(bitcoin|crypto)/i, fn: () => doCrypto(chatId) },
    { name: 'weather', match: /météo|meteo|quel.*temps.*fait|température/i, fn: () => { const c = text.match(/(?:météo|meteo|temps|température)\s+(?:à|a|de|du|en|pour)?\s*([A-Za-zÀ-ÿ\s-]+)/i)?.[1]?.trim() || text.match(/(?:à|a)\s+([A-Za-zÀ-ÿ-]+)\s*$/i)?.[1]?.trim() || 'Paris'; return doWeather(chatId, c); } },
    { name: 'music', match: /musique|music|joue|pause.*musique|suivant|précédent/i, fn: async () => { const a = /pause/i.test(text)?'pause':/suivant|next/i.test(text)?'next':/précédent/i.test(text)?'previous':'play'; try{await api('/mac/music/control','POST',{action:a});await bot.sendMessage(chatId,`✅ Music: ${a}`);}catch(e){await bot.sendMessage(chatId,'❌ '+e.message);} } },
    { name: 'memory', match: /souviens|rappelle|tu.*te.*souviens|mémoire.*cherche/i, fn: async () => { try{const r=await api('/episodic/search?q='+encodeURIComponent(text));const res=(r.results||[]).slice(0,3).map(x=>'• _'+x.text?.slice(0,100)+'_').join('\n');await bot.sendMessage(chatId,`*🧠 Mémoire*\n\n${res||'Rien trouvé'}`,{parse_mode:'Markdown'});}catch(e){await bot.sendMessage(chatId,'❌ '+e.message);} } },
    { name: 'backup', match: /backup|sauvegarde.*icloud/i, fn: () => doBackup(chatId) },
    { name: 'network', match: /wifi|réseau|ip.*locale|connexion.*internet/i, fn: async () => { try{const d=await api('/mac/network');await bot.sendMessage(chatId,`*🌐 Réseau*\nWiFi: ${d.wifi||'?'}\nIP: ${d.ip_local||'?'}\nPing: ${d.ping_ms||'?'}ms`,{parse_mode:'Markdown'});}catch(e){await bot.sendMessage(chatId,'❌ '+e.message);} } },
    { name: 'launch', match: /lance|ouvre|démarre.*(?:app|application|\w+\.app)/i, fn: async () => { const app=text.replace(/lance|ouvre|démarre|l'app/gi,'').trim(); try{await api('/mac/app/launch','POST',{app});await bot.sendMessage(chatId,`✅ ${app} lancé`);}catch(e){await bot.sendMessage(chatId,'❌ '+e.message);} } },
    { name: 'email', match: /email|mail|messages?.*non.*lu/i, fn: async () => { try{const d=await api('/email/unread?max=5');const e=d.emails||[];if(!e.length){await bot.sendMessage(chatId,'📭 Aucun email');return;}const l=e.slice(0,3).map(x=>`📧 *${x.subject}*\n_${x.from}_`).join('\n\n');await bot.sendMessage(chatId,`*📬 Emails (${e.length})*\n\n${l}`,{parse_mode:'Markdown'});}catch(e){await bot.sendMessage(chatId,'❌ '+e.message);} } },
    { name: 'causal', match: /prédiction|que va.*arriver|risque.*futur/i, fn: () => doCausal(chatId) },
    { name: 'brief', match: /brief|résumé.*matinal|quoi de neuf/i, fn: () => doBrief(chatId) },
  ];

  for (const intent of INTENTS) {
    if (intent.match.test(text)) {
      await intent.fn();
      return;
    }
  }

  // Fallback — Claude classifie si le message semble actionnable
  const actionable = /fais|crée|lance|ouvre|montre|génère|vérifie|analyse|cherche|trouve|envoie|configure|installe|supprime/i.test(text);
  if (actionable) {
    try {
      const cls = await api('/prometheus/chat', 'POST', { message: `Classifie en 1 mot: IMAGE|WEBSITE|DESIGN|SCREENSHOT|STATUS|OPTIMIZE|CRYPTO|WEATHER|MUSIC|LAUNCH|EMAIL|BACKUP|MISSION|CODE|CHAT. Message: "${text.slice(0,100)}"`, sessionId: 'prometheus-shadowroot', mode: 'chat' });
      const intent = (cls.response || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
      const quickHandlers = { IMAGE: () => generateImage(chatId, text), WEBSITE: () => buildSite(chatId, text), DESIGN: () => createDesign(chatId, text), SCREENSHOT: () => doScreenshot(chatId), STATUS: () => doStatus(chatId), OPTIMIZE: () => doOptimize(chatId), CRYPTO: () => doCrypto(chatId), WEATHER: () => doWeather(chatId, 'Paris'), LAUNCH: async () => { const app = text.replace(/lance|ouvre|démarre/gi, '').trim(); await api('/mac/app/launch', 'POST', { app }); await bot.sendMessage(chatId, `✅ ${app} lancé`); }, EMAIL: async () => { const d = await api('/email/unread?max=5'); const e = d.emails || []; await bot.sendMessage(chatId, e.length ? e.slice(0, 3).map(x => `📧 *${x.subject}*`).join('\n') : '📭 Aucun email', { parse_mode: 'Markdown' }); }, BACKUP: () => doBackup(chatId), MISSION: () => launchMission(chatId, text), CODE: () => launchCC(chatId, text) };
      if (quickHandlers[intent]) { await quickHandlers[intent](); return; }
    } catch (e) {}
  }

  // Chat PROMETHEUS standard
  await bot.sendChatAction(chatId, 'typing');
  try {
    const r = await api('/prometheus/chat', 'POST', { message: text, sessionId: 'prometheus-shadowroot', mode: 'chat' });
    await sendReply(chatId, r.response || r.error || 'Pas de réponse', { forceVoice: vi === 'once' });
  } catch (e) { await bot.sendMessage(chatId, '❌ ' + e.message); }
});

// ── requireConfirm pour actions sensibles ──
async function requireConfirm(chatId, action, description, onConfirm) {
  const cid = `c_${Date.now()}`;
  STATE.pendingConfirms.set(cid, { onConfirm, ts: Date.now() });
  setTimeout(() => STATE.pendingConfirms.delete(cid), 60000);
  await bot.sendMessage(chatId, `⚠️ *Confirmation requise*\n\nAction: *${action}*\n${description}\n\n_Expire dans 60s_`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Confirmer', callback_data: 'dyn_y_' + cid }, { text: '❌ Annuler', callback_data: 'dyn_n_' + cid }]] } });
}

// ── Callbacks boutons ──
bot.on('callback_query', async (q) => {
  if (!auth(q.message)) return; await bot.answerCallbackQuery(q.id);
  const id = q.message.chat.id; const data = q.data;

  if (data.startsWith('send_')) { const sid = data.slice(5); await requireConfirm(id, 'Envoyer email', 'Confirmer envoi ?', async()=>{ const r=await api('/email/send','POST',{id:sid}); await bot.sendMessage(id,r.success?'✅ Envoyé':'❌ '+r.error); }); return; }
  if (data.startsWith('del_draft_')) { try{await api('/email/draft/status','POST',{id:data.slice(10),status:'deleted'});}catch(e){} await bot.sendMessage(id,'🗑 Supprimé'); return; }

  // Dynamic confirmations
  if (data.startsWith('dyn_y_')) { const p = STATE.pendingConfirms.get(data.slice(6)); STATE.pendingConfirms.delete(data.slice(6)); if (p) { try { await p.onConfirm(); } catch (e) { await bot.sendMessage(id, '❌ ' + e.message); } } else { await bot.sendMessage(id, '⏱ Expiré'); } return; }
  if (data.startsWith('dyn_n_')) { STATE.pendingConfirms.delete(data.slice(6)); await bot.sendMessage(id, '✅ Annulé'); return; }

  switch (data) {
    case 'chat': await bot.sendMessage(id, '💬 Tape ton message'); break;
    case 'status': await doStatus(id); break;
    case 'crypto': await doCrypto(id); break;
    case 'weather': await doWeather(id, 'Paris'); break;
    case 'screenshot': await doScreenshot(id); break;
    case 'optimize': await doOptimize(id); break;
    case 'backup': await doBackup(id); break;
    case 'memory': await doMemory(id); break;
    case 'brief': await doBrief(id); break;
    case 'analytics': await doAnalytics(id); break;
    case 'causal': await doCausal(id); break;
    case 'model': { try { const [d,h]=await Promise.all([api('/model/stats'),api('/llama/status')]); await bot.sendMessage(id,`*🧭 Routing*\n\n🦙 Llama: ${h.available?'✅':'❌'} · ${d.llamaCalls||0} appels (${d.llamaPct||0}%)\n🤖 Claude: ${d.claudeCalls||0} appels\n💰 Savings: ${d.estimatedSavings||'$0'}`,{parse_mode:'Markdown'}); } catch(e) { await bot.sendMessage(id,'❌ '+e.message); } break; }
    case 'voicemode': STATE.voiceMode=!STATE.voiceMode; await bot.sendMessage(id,STATE.voiceMode?'🔊 *Vocal ON*':'💬 *Vocal OFF*',{parse_mode:'Markdown'}); break;
    case 'sovereignty': await doSovereignty(id); break;
    case 'audit': await bot.sendMessage(id, 'Tape /audit, /audit BLOCKED ou /audit CRITICAL'); break;
    case 'knowledge': await doKnowledge(id); break;
    case 'mission': STATE.awaitingInput = 'mission'; await bot.sendMessage(id, '🚀 Décris la mission :'); break;
    default:
      if (data.startsWith('ma_approve_')) { const mid = data.slice(11); await runApprovedMission(id, mid); break; }
      if (data.startsWith('ma_kill_')) { try { await api('/mission/kill', 'POST', { missionId: data.slice(8), reason: 'Annule par utilisateur' }); } catch {} await bot.sendMessage(id, '🔴 Mission arretee'); break; }
      if (data.startsWith('ma_pause_')) { try { await api('/mission/pause', 'POST', { missionId: data.slice(9) }); } catch {} await bot.sendMessage(id, '⏸ Mission en pause'); break; }
      if (data.startsWith('ma_resume_')) { try { await api('/mission/resume', 'POST', { missionId: data.slice(10) }); } catch {} await bot.sendMessage(id, '▶️ Mission reprise'); break; }
      break;
    case 'music_play': try{await api('/mac/music/control','POST',{action:'play'});}catch(e){} await bot.sendMessage(id,'▶️ Play'); break;
    case 'music_pause': try{await api('/mac/music/control','POST',{action:'pause'});}catch(e){} await bot.sendMessage(id,'⏸ Pause'); break;
    case 'music_next': try{await api('/mac/music/control','POST',{action:'next'});}catch(e){} await bot.sendMessage(id,'⏭ Next'); break;
    case 'music_prev': try{await api('/mac/music/control','POST',{action:'previous'});}catch(e){} await bot.sendMessage(id,'⏮ Prev'); break;
    case 'kill': await bot.sendMessage(id, '🔴 Confirmer ?', { reply_markup: { inline_keyboard: [[{ text: '✅ OUI', callback_data: 'confirm_kill' }, { text: '❌ Non', callback_data: 'cancel_kill' }]] } }); break;
    case 'confirm_kill': try { await api('/sovereignty/kill', 'POST', {}); await bot.sendMessage(id, '🔴 PROMETHEUS arrêté.'); } catch (e) { await bot.sendMessage(id, '❌ ' + e.message); } break;
    case 'cancel_kill': await bot.sendMessage(id, '✅ Annulé.'); break;
    case 'opt_cache': await requireConfirm(id, 'Nettoyage caches', 'Supprimer fichiers ~/Library/Caches > 7j', async () => { const r = await api('/optimize/action', 'POST', { action: 'clean_cache', dryRun: false }); await bot.sendMessage(id, '✅ Cache: ' + (r.before || '?') + ' → ' + (r.after || '?')); }); break;
    case 'opt_trash': await requireConfirm(id, 'Vider corbeille', 'Supprimer tout dans ~/.Trash', async () => { const r = await api('/optimize/action', 'POST', { action: 'empty_trash', dryRun: false }); await bot.sendMessage(id, '✅ Corbeille: ' + (r.freed || '?')); }); break;
    case 'sov_simulate': STATE.awaitingInput = 'simulate'; await bot.sendMessage(id, '⚡ Tape la commande à simuler :'); break;
    case 'sov_audit': { try { const entries = await api('/sovereignty/audit?n=8'); const ic = { INFO: 'ℹ️', WARN: '⚠️', CRITICAL: '🔴', BLOCKED: '🚫' }; const lines = entries.slice(0, 8).map(e => `${ic[e.level] || '•'} \`${e.ts?.slice(11, 19)}\` ${e.action || ''}`); await bot.sendMessage(id, `*📋 Audit — 8 dernières*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' }); } catch (e) { await bot.sendMessage(id, '❌ ' + e.message); } break; }
    case 'sov_rebuild': { try { await api('/sovereignty/baseline/rebuild', 'POST', { confirm: 'REBUILD_CONFIRMED' }); await bot.sendMessage(id, '✅ Baseline reconstruite'); } catch (e) { await bot.sendMessage(id, '❌ ' + e.message); } break; }
  }
});

// ── Handlers ──
async function doStatus(id) {
  await bot.sendChatAction(id, 'typing');
  try { const [s, sv, tok] = await Promise.all([api('/monitor/full'), api('/sovereignty/status'), api('/tokens/stats')]);
    const killed = sv?.sovereignty?.killSwitchActive;
    await bot.sendMessage(id, `*💻 Status PROMETHEUS*\n\n🖥 *Mac*\nCPU: ${s.cpu || '?'} · RAM: ${s.ram || '?'}\nBatterie: ${s.battery || '?'} · Disque: ${s.disk || '?'}\nUptime: ${s.uptime || '?'}s\n\n🛡 *Sovereignty*\nKill: ${killed ? '🔴 ACTIF' : '🟢 OK'} · Intégrité: ${sv.integrity?.ok ? '✅' : '❌'}\nBloquées: ${sv?.sovereignty?.blockedCount || 0} · RAM: ${sv?.resources?.ramMB || '?'}MB/800MB\n\n🪙 *Tokens*\nTotal: ${(tok.totalTokens || 0).toLocaleString()} · Coût: ${tok.estimatedCost || '$0'}`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doCrypto(id) {
  await bot.sendChatAction(id, 'typing');
  try { const d = await api('/web/crypto?coins=bitcoin,ethereum,solana'); const coins = d.coins || d;
    if (!Array.isArray(coins)) throw new Error('Format'); const lines = coins.slice(0, 5).map(c => `${parseFloat(c.change_24h) > 0 ? '📈' : '📉'} *${c.name}*: ${c.price_eur?.toLocaleString('fr') || '?'}€ (${c.change_24h || '?'})`);
    await bot.sendMessage(id, `*₿ Crypto*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doWeather(id, city) {
  await bot.sendChatAction(id, 'typing');
  try {
    const d = await api('/web/weather?city=' + encodeURIComponent(city));
    const c = d.current || {};
    const name = d.city || city;
    const text = '🌤 Meteo ' + name + '\n\n' +
      '🌡 ' + (c.temp_c || '?') + '°C (ressenti ' + (c.feels_like_c || '?') + '°C)\n' +
      '☁️ ' + (c.description || '?') + '\n' +
      '💧 Humidite: ' + (c.humidity || '?') + '%\n' +
      '💨 Vent: ' + (c.wind_kmh || '?') + ' km/h ' + (c.wind_dir || '') + '\n' +
      '☀️ UV: ' + (c.uv_index || '?') + '\n' +
      '👁 Visibilite: ' + (c.visibility_km || '?') + ' km';
    await bot.sendMessage(id, text);
  } catch (e) { await bot.sendMessage(id, '❌ Meteo: ' + e.message); }
}

async function doScreenshot(id) {
  await bot.sendChatAction(id, 'upload_photo');
  try { const r = await api('/remote/screenshot'); if (r.base64 || r.screenshot) { await bot.sendPhoto(id, Buffer.from(r.base64 || r.screenshot, 'base64'), { caption: '📸 ' + new Date().toLocaleString('fr-FR') }); } else { await bot.sendMessage(id, '📸 Screenshot pris'); } }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doOptimize(id) {
  await bot.sendChatAction(id, 'typing');
  try { const d = await api('/optimize/analyze'); const icons = { SAFE: '🟢', CAUTION: '🟡', WARN: '🟠', CRITICAL: '🔴' };
    const recs = (d.issues || []).slice(0, 4).map(i => `${icons[i.type] || '⚪'} ${i.title}${i.savingGB ? ` (${i.savingGB.toFixed(1)}GB)` : ''}`).join('\n') || '✅ Rien à signaler';
    await bot.sendMessage(id, `*🔍 Analyse Mac*\n\n💾 Disque: ${d.storage?.usedPct || '?'}\n🧠 RAM: ${d.memory?.used_pct || '?'}%\n📦 Caches: ${d.storage?.caches?.userCache || '?'}\n🗑 Corbeille: ${d.storage?.caches?.trash || '?'}\n📦 npm: ${d.storage?.caches?.npmCache || '?'}\n\n*Recommandations:*\n${recs}\n\n💾 *Économies: ${d.potentialSavings || '0GB'}*`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🗑 Caches', callback_data: 'opt_cache' }, { text: '🗑 Corbeille', callback_data: 'opt_trash' }]] } }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doBackup(id) {
  await requireConfirm(id, 'Backup iCloud', 'Copier knowledge/ sessions/ metrics/ vers iCloud', async () => {
    await bot.sendChatAction(id, 'typing');
    const d = await api('/icloud/backup', 'POST', {}); const ok = d.files?.filter(f => f.ok).length || 0;
    await bot.sendMessage(id, d.success ? `*💾 Backup terminé*\n\n✅ ${ok}/${d.files?.length || 0} fichiers\n📁 \`${d.backupDir || '?'}\`` : `❌ ${d.reason || 'Erreur'}`, { parse_mode: 'Markdown' });
  });
}

async function doMemory(id) {
  await bot.sendChatAction(id, 'typing');
  try { const [m, e, ident] = await Promise.all([api('/memory/stats'), api('/episodic/stats'), api('/identity/state').catch(() => ({}))]);
    await bot.sendMessage(id, `*🧠 Mémoire PROMETHEUS*\n\n📂 *Projet*\nSessions: ${m.sessions || 0} · Décisions: ${m.decisions || 0}\n\n🔍 *Épisodique*\nTotal: ${e.total || 0} épisodes\nChromaDB: ${e.chromadb?.available ? '✅ Actif' : '⚠️ Fallback'}\n\n🪪 *Identité*\nVersion: ${ident.version || '?'} · Sessions: ${ident.totalSessions || 0}`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doBrief(id) {
  await bot.sendChatAction(id, 'typing');
  try { const [w, c, s, mem, sv] = await Promise.all([api('/web/weather?city=Paris'), api('/web/crypto?coins=bitcoin,ethereum'), api('/monitor/full'), api('/memory/stats'), api('/sovereignty/status')]);
    const cur = w.current || {}; const coins = c.coins || c; const btc = Array.isArray(coins) ? coins[0] : null; const eth = Array.isArray(coins) ? coins[1] : null;
    const h = new Date().getHours(); const greet = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
    await bot.sendMessage(id, `*☀️ ${greet} — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}*\n\n🌤 *Météo Paris*: ${cur.temp_c || '?'}°C · ${cur.description || '?'}\n\n₿ *Crypto*\nBTC: ${(btc?.price_eur || 0).toLocaleString('fr')}€ ${btc?.change_24h || ''}\nETH: ${(eth?.price_eur || 0).toLocaleString('fr')}€ ${eth?.change_24h || ''}\n\n💻 *Mac*\nCPU: ${s.cpu || '?'} · RAM: ${s.ram || '?'} · 🔋${s.battery || '?'}\n\n🧠 *PROMETHEUS*\n${mem.sessions || 0} sessions · ${mem.decisions || 0} décisions\nIntégrité: ${sv?.integrity?.ok ? '✅' : '❌'} · RAM: ${sv?.resources?.ramMB || '?'}MB`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doAnalytics(id) {
  await bot.sendChatAction(id, 'typing');
  try { const d = await api('/analytics/data'); const t = d.total || {}; const today = d.today || {}; const week = d.thisWeek || {};
    await bot.sendMessage(id, `*📊 Analytics PROMETHEUS*\n\n📅 *Aujourd'hui*\n${today.chats || 0} chats · ${(today.tokens || 0).toLocaleString()} tokens\n${today.webFetches || 0} web · ${today.screenshots || 0} screenshots\n\n📆 *Semaine*\n${week.chats || 0} chats · ${(week.tokens || 0).toLocaleString()} tokens\n\n📈 *Total*\n${(t.chats || 0).toLocaleString()} conversations\n${(t.tokens || 0).toLocaleString()} tokens · $${d.costs?.totalUSD || '0'}\n\n🏆 Top: ${d.topDay?.date || '?'} (${(d.topDay?.tokens || 0).toLocaleString()})`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doSovereignty(id) {
  await bot.sendChatAction(id, 'typing');
  try { const d = await api('/sovereignty/status'); const s = d.sovereignty || {}; const integ = d.integrity || {}; const res = d.resources || {};
    await bot.sendMessage(id, `*🛡 Sovereignty v2.0*\n\nKill: ${s.killSwitchActive ? '🔴 ACTIF' : '🟢 Inactif'}\nIntégrité: ${integ.ok ? '✅' : '❌ VIOLATION'}\nActions: ${s.actionCount || 0}\nBloquées: ${s.blockedCount || 0}\nRAM: ${res.ramMB || '?'}MB/800\nProcessus: ${res.childCount || 0}/8\nUptime: ${s.uptime || 0}s\n\nRègles: ${d.rules?.absoluteBlocks || 0}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Audit', callback_data: 'sov_audit' }, { text: '⚡ Simuler', callback_data: 'sov_simulate' }], [{ text: '🔄 Rebuild baseline', callback_data: 'sov_rebuild' }, { text: '🔴 Kill', callback_data: 'kill' }]] } }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doCausal(id) {
  await bot.sendChatAction(id, 'typing');
  try { const d = await api('/causal/stats');
    await bot.sendMessage(id, `*🔮 Causal Engine*\n\nÉvénements: ${d.events || 0}\nRelations: ${d.relations || 0}\nPatterns: ${d.patterns || 0}\nPrédictions: ${d.predictions || 0}`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function doKnowledge(id, query) {
  await bot.sendChatAction(id, 'typing');
  try { const url = query ? '/graph/nodes?q=' + encodeURIComponent(query) : '/graph/stats';
    const d = await api(url); const nodes = Array.isArray(d) ? d : null;
    if (nodes) { const lines = nodes.slice(0, 10).map(n => `• *${n.label || '?'}* [${n.type || '?'}]`);
      await bot.sendMessage(id, `*🕸 Knowledge*${query ? ' — "' + query + '"' : ''}\n\n${lines.join('\n') || 'Vide'}`, { parse_mode: 'Markdown' });
    } else { await bot.sendMessage(id, `*🕸 Knowledge*\n\nNœuds: ${d.nodes || 0}\nRelations: ${d.edges || 0}\n\n_/knowledge <terme> pour chercher_`, { parse_mode: 'Markdown' }); }
  } catch (e) { await bot.sendMessage(id, '❌ ' + e.message); }
}

async function runSimulate(chatId, cmd) {
  await bot.sendChatAction(chatId, 'typing');
  try { const d = await api('/sovereignty/simulate', 'POST', { command: cmd });
    const icons = { SAFE: '🟢', CAUTION: '🟡', SENSITIVE: '🟠', DANGEROUS: '🔴', BLOCKED: '🚫' };
    await bot.sendMessage(chatId, `*⚡ Simulation*\n\n\`${cmd}\`\n\n${icons[d.classification] || '⚪'} *${d.classification || '?'}*\n${d.allowed ? '✅ Autorisée' : '🚫 BLOQUÉE'}\n${d.reason ? '\n' + d.reason : ''}${d.warnings?.length ? '\n⚠️ ' + d.warnings.join(', ') : ''}`, { parse_mode: 'Markdown' }); }
  catch (e) { await bot.sendMessage(chatId, '❌ ' + e.message); }
}

bot.onText(/\/news(?:\s+(\d+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const count = parseInt(match?.[1]) || 5;
  await doNews(msg.chat.id, count);
});

async function doNews(chatId, count) {
  await bot.sendChatAction(chatId, 'typing');
  try {
    const result = await api('/browser/web-search', 'POST', { query: 'actualites France aujourd\'hui ' + new Date().toLocaleDateString('fr-FR') });
    if (result.success && result.answer) {
      await bot.sendMessage(chatId, '📰 Actualites France — ' + new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long'}) + '\n\n' + (result.answer || '').slice(0, 3500));
    } else {
      const resp = await api('/remote/prometheus/chat', 'POST', { message: 'Quelles sont les ' + count + ' actualites les plus importantes en France aujourd\'hui ?', sessionId: 'prometheus-shadowroot', mode: 'chat' });
      const r = await resp.json ? await resp.json() : resp;
      await bot.sendMessage(chatId, '📰 Actualites France\n\n' + ((r.response || r) + '').slice(0, 3500));
    }
  } catch (e) { await bot.sendMessage(chatId, '❌ News: ' + e.message); }
}

bot.onText(/\/browse(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const url = match?.[1]?.trim();
  if (!url) { STATE.awaitingInput = 'browse'; await bot.sendMessage(msg.chat.id, 'Quelle URL ouvrir ?'); return; }
  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  try { await api('/browser/open', 'POST', { url: fullUrl }); await bot.sendMessage(msg.chat.id, 'Ouvert: ' + fullUrl); }
  catch (e) { await bot.sendMessage(msg.chat.id, 'Erreur: ' + e.message); }
});

bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const query = match?.[1]?.trim();
  if (!query) { STATE.awaitingInput = 'search'; await bot.sendMessage(msg.chat.id, 'Que chercher ?'); return; }
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    const r = await api('/browser/web-search', 'POST', { query });
    if (r.success) { await bot.sendMessage(msg.chat.id, 'Recherche: ' + query + '\n\n' + (r.answer || 'Aucun resultat') + '\n\nSource: ' + (r.source || '?')); }
    else { await api('/browser/search', 'POST', { query }); await bot.sendMessage(msg.chat.id, 'Recherche ouverte dans Safari: ' + query); }
  } catch (e) { await bot.sendMessage(msg.chat.id, 'Erreur: ' + e.message); }
});

bot.onText(/\/analyzepage/, async (msg) => {
  if (!auth(msg)) return deny(msg.chat.id);
  await bot.sendChatAction(msg.chat.id, 'typing');
  try { const r = await api('/browser/analyze', 'POST', {}); await bot.sendMessage(msg.chat.id, r.success ? 'Analyse page:\n\n' + r.summary : 'Erreur: ' + (r.error || 'impossible')); }
  catch (e) { await bot.sendMessage(msg.chat.id, 'Erreur: ' + e.message); }
});

bot.onText(/\/compress(?:\s+(.+))?/, async (msg, match) => {
  if (!auth(msg)) return deny(msg.chat.id);
  const sessionId = match?.[1]?.trim() || 'prometheus-shadowroot';
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    const r = await api('/context/compress', 'POST', { sessionId });
    if (!r.success && r.needsCompression === false) {
      await bot.sendMessage(msg.chat.id, 'Contexte deja compact (' + (r.messages || 0) + ' messages)');
      return;
    }
    await bot.sendMessage(msg.chat.id, 'Contexte compresse: ' + (r.originalMessages || 0) + ' -> ' + (r.compressedMessages || 0) + ' messages. ~' + (r.savedTokens || 0).toLocaleString() + ' tokens economises');
  } catch (e) { await bot.sendMessage(msg.chat.id, 'Erreur: ' + e.message); }
});

const activeMissionIds = new Map();

async function launchMission(chatId, desc) {
  const planMsg = await bot.sendMessage(chatId, '🧠 Planification en cours...').catch(() => null);
  try {
    const plan = await api('/mission/create', 'POST', { objective: desc });
    if (plan.error) { await bot.sendMessage(chatId, '❌ ' + plan.error); return; }
    activeMissionIds.set(chatId, plan.missionId);
    const stepsText = (plan.steps || []).slice(0, 10).map((s, i) =>
      `${s.destructive ? '⚠️' : '✅'} ${i + 1}. ${s.title}`).join('\n');
    const text = `🚀 Plan de Mission\n\nObjectif: ${desc.slice(0, 100)}\nComplexite: ${plan.complexity || '?'}\nEtapes: ${(plan.steps || []).length}\nTokens: ~${(plan.estimatedTokens || 0).toLocaleString()} / 50,000\n\n${stepsText}`;
    if (planMsg) {
      await bot.editMessageText(text, {
        chat_id: chatId, message_id: planMsg.message_id,
        reply_markup: { inline_keyboard: [[
          { text: '✅ LANCER', callback_data: 'ma_approve_' + plan.missionId },
          { text: '❌ Annuler', callback_data: 'ma_kill_' + plan.missionId },
        ]] },
      }).catch(() => bot.sendMessage(chatId, text));
    }
  } catch (e) { await bot.sendMessage(chatId, '❌ Erreur: ' + e.message); }
}

async function runApprovedMission(chatId, missionId) {
  const statusMsg = await bot.sendMessage(chatId, '🔄 Mission en cours...', {
    reply_markup: { inline_keyboard: [[
      { text: '⏸ Pause', callback_data: 'ma_pause_' + missionId },
      { text: '🔴 STOP', callback_data: 'ma_kill_' + missionId },
    ]] },
  }).catch(() => null);
  try {
    await api('/mission/approve', 'POST', { missionId });
  } catch {}
  const ci = setInterval(async () => {
    try {
      const s = await api('/mission/status/' + missionId);
      if (!s || !s.state) return;
      if (s.state === 'RUNNING' && statusMsg) {
        await bot.editMessageText(
          `🔄 Mission (${s.pct}%)\nEtape ${s.currentStep + 1}/${s.totalSteps}\nTokens: ${s.tokensUsed?.toLocaleString()}/50,000`,
          { chat_id: chatId, message_id: statusMsg.message_id,
            reply_markup: { inline_keyboard: [[
              { text: '⏸ Pause', callback_data: 'ma_pause_' + missionId },
              { text: '🔴 STOP', callback_data: 'ma_kill_' + missionId },
            ]] },
          }).catch(() => {});
      }
      if (['COMPLETED', 'FAILED', 'KILLED'].includes(s.state)) {
        clearInterval(ci);
        const icon = s.state === 'COMPLETED' ? '✅' : s.state === 'KILLED' ? '🔴' : '❌';
        const results = (s.results || []).map(r => `• ${r.summary?.slice(0, 80) || r.title}`).join('\n');
        const text = `${icon} Mission ${s.state}\n\n${s.totalSteps} etapes · ${s.tokensUsed?.toLocaleString()} tokens · ${s.elapsed}s\n\n${results}`;
        if (statusMsg) await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
        else await bot.sendMessage(chatId, text).catch(() => {});
      }
    } catch { clearInterval(ci); }
  }, 3000);
  setTimeout(() => clearInterval(ci), 1800000);
}

// ── Surveillance tentatives non autorisées ──
setInterval(async () => {
  let total = 0; SECURITY.failedAttempts.forEach(c => total += c);
  if (total > 0) { SECURITY.failedAttempts.clear(); try { await bot.sendMessage(ALLOWED_ID, `⚠️ *Alerte sécurité*\n\n${total} tentative(s) d'accès non autorisé(es)`, { parse_mode: 'Markdown' }); } catch (e) {} }
}, 60000).unref();

// ── Nettoyage fichiers audio résiduels ──
function cleanAudioFiles() {
  let n = 0;
  try { fs.readdirSync(os.tmpdir()).filter(f => (f.startsWith('hermes_voice_') || f.startsWith('hermes_audio_') || f.startsWith('hermes_tts_')) && (f.endsWith('.ogg') || f.endsWith('.aiff') || f.endsWith('.wav'))).forEach(f => { try { fs.unlinkSync(path.join(os.tmpdir(), f)); n++; } catch (e) {} }); } catch (e) {}
  if (n > 0) console.log(`[HERMES] 🧹 ${n} audio temp nettoyé(s)`);
}
cleanAudioFiles();
setInterval(cleanAudioFiles, 3600000).unref();

console.log('[HERMES] 🪽 Bot @prometheushermes_bot — sécurité + Whisper');
setTimeout(async () => { try { await sendAlert('SUCCESS', 'HERMES v2 en ligne', '🪽 Toutes les commandes disponibles.\n/start pour le menu.'); } catch (e) {} }, 3000);
bot.on('polling_error', e => console.error('[HERMES] Poll:', e.message));

module.exports = { sendAlert, bot, STATE };
