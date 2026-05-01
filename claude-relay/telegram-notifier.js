const fs = require('fs');
const path = require('path');

function getConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8')); } catch { return {}; }
}

let bot = null;

function init() {
  const cfg = getConfig();
  if (!cfg.telegramToken || !cfg.telegramChatId) return false;
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(cfg.telegramToken, { polling: false });
    return true;
  } catch { return false; }
}

async function send(message, options = {}) {
  if (!bot) init();
  if (!bot) return false;
  const cfg = getConfig();
  if (!cfg.telegramChatId) return false;
  const { emoji = '\u26A1', silent = false } = options;
  try {
    await bot.sendMessage(cfg.telegramChatId, `${emoji} *PROMETHEUS v7.2*\n\n${message}`, {
      parse_mode: 'Markdown', disable_notification: silent
    });
    return true;
  } catch (e) {
    console.error('[Telegram]', e.message);
    return false;
  }
}

const notify = {
  missionStart: (obj) => send(`\uD83D\uDE80 Mission:\n_${obj}_`, { emoji: '\uD83D\uDE80' }),
  missionComplete: (obj, dur) => send(`\u2705 Complete!\n_${obj}_\nDuration: ${dur}s`, { emoji: '\u2705' }),
  escalation: (reason) => send(`\u26A0\uFE0F INTERVENTION\n${reason}`, { emoji: '\u26A0\uFE0F' }),
  selfHealed: (err) => send(`\uD83E\uDE7A Auto-healed: ${err}`, { emoji: '\uD83E\uDE7A', silent: true }),
  securityAlert: (ip, type) => send(`\uD83D\uDEE1\uFE0F Security\nIP: ${ip}\nType: ${type}`, { emoji: '\uD83D\uDEE1\uFE0F' }),
  loginRemote: (ip) => send(`\uD83D\uDD10 Remote login\nIP: ${ip}`, { emoji: '\uD83D\uDD10' }),
  systemStart: () => send('\u2705 PROMETHEUS v7.2 online', { emoji: '\uD83D\uDD25' }),
  dailyReport: (s) => send(`\uD83D\uDCCA Report\nSessions: ${s.sessions}\nDecisions: ${s.decisions}\nTokens: ${s.tokens}`, { emoji: '\uD83D\uDCCA' })
};

function configure(token, chatId) {
  const cfg = getConfig();
  cfg.telegramToken = token;
  cfg.telegramChatId = chatId;
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 2));
  bot = null;
  return init();
}

module.exports = { init, send, notify, configure };
