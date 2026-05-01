'use strict';
const { execSync, exec } = require('child_process');

const OPTS = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 };

function as(script, opts = {}) {
  try { return execSync(`osascript -ss -e '${script.replace(/'/g, "\\'")}'`, { ...OPTS, timeout: opts.timeout || 8000 }).trim(); }
  catch { return opts.fallback || null; }
}

function sh(cmd, opts = {}) {
  try { return execSync(cmd + ' 2>/dev/null', { ...OPTS, timeout: opts.timeout || 5000 }).trim(); }
  catch { return opts.fallback || ''; }
}

function shBg(cmd) { exec(cmd + ' 2>/dev/null &'); }

function screenshot(out) { return sh(`screencapture -x -C "${out}"`, { timeout: 5000 }); }
function webcam(out) { return sh(`imagesnap -q -w 0 "${out}"`, { timeout: 8000, fallback: null }); }
function openBg(target) { return sh(`open -jg "${target}"`, { timeout: 3000 }); }
function notify(title, msg) { return as(`display notification "${msg}" with title "${title}" sound name ""`); }

module.exports = { as, sh, shBg, screenshot, webcam, openBg, notify, OPTS };
