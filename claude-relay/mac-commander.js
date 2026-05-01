const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LOGS_DIR = path.join(__dirname, 'logs');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const BLOCKED_COMMANDS = [/rm\s+-rf\s+\/(?!\w)/, /mkfs/, /dd\s+if=\/dev\/zero/, /format\s+disk/i, />\s*\/dev\/sd/];
const fileRegistry = new Map();

// Cleanup old downloads every hour (unref to not block process.exit)
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of fileRegistry) {
    if (now - entry.createdAt > 3600000) {
      try { fs.unlinkSync(entry.path); } catch {}
      fileRegistry.delete(id);
    }
  }
}, 600000);
if (_cleanupTimer.unref) _cleanupTimer.unref();

function log(action, detail) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 19);
    fs.appendFileSync(path.join(LOGS_DIR, `mac-${date}.log`), `[${time}] [${action}] ${detail}\n`);
  } catch {}
}

function osa(script) {
  log('APPLESCRIPT', script.slice(0, 100));
  return execSync(`osascript -ss -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 }).toString().trim();
}

function resolvePath(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function checkDangerous(cmd) {
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) throw new Error(`BLOCKED: Dangerous command detected: ${cmd.slice(0, 50)}`);
  }
}

// ── SCREEN ──
function takeScreenshot(opts = {}) {
  const tmp = `/tmp/relay-screen-${Date.now()}.png`;
  log('SCREENSHOT', tmp);
  execSync(`screencapture -x -C ${tmp}`, { timeout: 10000 });
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

function getScreenInfo() {
  log('SCREEN_INFO', '');
  const frontApp = osa('tell application "System Events" to get name of first process whose frontmost is true');
  return { frontApp };
}

let screenStreamInterval = null;
function startScreenStream(broadcast, intervalMs = 2000, quality = 60) {
  stopScreenStream();
  screenStreamInterval = setInterval(() => {
    try {
      const buf = takeScreenshot();
      broadcast({ event: 'screen_frame', imageBase64: buf.toString('base64'), timestamp: Date.now() });
    } catch {}
  }, intervalMs);
}
function stopScreenStream() { if (screenStreamInterval) { clearInterval(screenStreamInterval); screenStreamInterval = null; } }

// ── CAMERA ──
const camera = {
  takePicture() {
    const tmp = `/tmp/relay-cam-${Date.now()}.jpg`;
    log('CAMERA', 'takePicture');
    execSync(`imagesnap -q -w 1 ${tmp}`, { timeout: 15000 });
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return buf;
  },
  startStream(broadcast, intervalMs = 2000) {
    camera._interval = setInterval(() => {
      try {
        const buf = camera.takePicture();
        broadcast({ event: 'camera_frame', imageBase64: buf.toString('base64'), timestamp: Date.now() });
      } catch {}
    }, intervalMs);
  },
  stopStream() { if (camera._interval) { clearInterval(camera._interval); camera._interval = null; } },
  getAvailableCameras() {
    try { return execSync('imagesnap -l 2>&1', { timeout: 5000 }).toString().trim(); } catch { return ''; }
  }
};

// ── AUDIO ──
const audio = {
  startRecording(durationSec = 10, outputPath) {
    const out = outputPath || `/tmp/relay-audio-${Date.now()}.wav`;
    log('AUDIO', `record ${durationSec}s`);
    exec(`sox -d -r 44100 -c 1 ${out} trim 0 ${durationSec}`);
    return out;
  },
  stopRecording() { try { execSync('pkill sox 2>/dev/null'); } catch {} },
  playSound(filePath) { exec(`afplay "${resolvePath(filePath)}"`); },
  setVolume(level) { osa(`set volume output volume ${Math.max(0, Math.min(100, level))}`); },
  getVolume() { return osa('output volume of (get volume settings)'); }
};

// ── MOUSE ──
const mouse = {
  click(x, y, button = 'left') {
    log('MOUSE', `click ${x},${y} ${button}`);
    // Use cliclick if available, otherwise AppleScript
    try { execSync(`cliclick c:${x},${y}`, { timeout: 5000 }); }
    catch { osa(`tell application "System Events" to click at {${x}, ${y}}`); }
  },
  rightClick(x, y) { try { execSync(`cliclick rc:${x},${y}`, { timeout: 5000 }); } catch {} },
  doubleClick(x, y) { try { execSync(`cliclick dc:${x},${y}`, { timeout: 5000 }); } catch {} },
  moveTo(x, y) { try { execSync(`cliclick m:${x},${y}`, { timeout: 5000 }); } catch {} },
  drag(fromX, fromY, toX, toY) { try { execSync(`cliclick dd:${fromX},${fromY} du:${toX},${toY}`, { timeout: 5000 }); } catch {} },
  scroll(x, y, direction = 'down', amount = 3) {
    const dir = direction === 'up' ? amount : -amount;
    osa(`tell application "System Events" to scroll area 1 by ${dir}`);
  }
};

// ── KEYBOARD ──
const keyboard = {
  type(text) { log('KEYBOARD', `type ${text.slice(0, 30)}`); osa(`tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"`); },
  typeSlowly(text, delayMs = 50) {
    for (const char of text) {
      osa(`tell application "System Events" to keystroke "${char.replace(/"/g, '\\"')}"`);
      execSync(`sleep ${delayMs / 1000}`);
    }
  },
  press(key, modifiers = []) {
    const keyCodes = { return: 36, tab: 48, space: 49, escape: 53, delete: 51, up: 126, down: 125, left: 123, right: 124, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f12: 111 };
    const code = keyCodes[key.toLowerCase()];
    const mods = modifiers.map(m => `${m} down`).join(', ');
    if (code !== undefined) {
      const script = mods ? `tell application "System Events" to key code ${code} using {${mods}}` : `tell application "System Events" to key code ${code}`;
      osa(script);
    }
  },
  shortcut(combo) {
    log('KEYBOARD', `shortcut ${combo}`);
    const parts = combo.toLowerCase().split('+').map(p => p.trim());
    const key = parts.pop();
    const modMap = { cmd: 'command', command: 'command', ctrl: 'control', alt: 'option', shift: 'shift' };
    const mods = parts.map(m => `${modMap[m] || m} down`).join(', ');
    osa(`tell application "System Events" to keystroke "${key}" using {${mods}}`);
  }
};

// ── SAFARI ──
const safari = {
  openURL(url) { log('SAFARI', `open ${url}`); osa(`tell application "Safari" to open location "${url}"`); osa('tell application "Safari" to activate'); },
  getCurrentURL() { return osa('tell application "Safari" to get URL of current tab of front window'); },
  getTitle() { return osa('tell application "Safari" to get name of current tab of front window'); },
  executeJS(code) { return osa(`tell application "Safari" to do JavaScript "${code.replace(/"/g, '\\"')}" in current tab of front window`); },
  readPageContent() { return safari.executeJS('document.body.innerText'); },
  screenshot() { return takeScreenshot(); },
  click(selector) { safari.executeJS(`document.querySelector('${selector}').click()`); },
  fillForm(selector, value) { safari.executeJS(`document.querySelector('${selector}').value='${value.replace(/'/g, "\\'")}'`); },
  newTab(url) { osa(`tell application "Safari" to make new tab in front window with properties {URL:"${url}"}`); },
  closeTab() { osa('tell application "Safari" to close current tab of front window'); },
  back() { safari.executeJS('history.back()'); },
  reload() { osa('tell application "Safari" to set URL of current tab of front window to URL of current tab of front window'); },
  getAllTabs() { return osa('tell application "Safari" to get URL of every tab of front window').split(', '); },
  switchToTab(index) { osa(`tell application "Safari" to set current tab of front window to tab ${index + 1} of front window`); },
  waitForElement(selector, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const r = safari.executeJS(`!!document.querySelector('${selector}')`); if (r === 'true') return true; } catch {}
      execSync('sleep 0.5');
    }
    return false;
  },
  extractLinks() { return safari.executeJS('JSON.stringify([...document.querySelectorAll("a[href]")].map(a=>a.href))'); }
};

// ── MESSAGES ──
const messages = {
  sendText(contact, text) {
    log('MESSAGES', `send to ${contact}`);
    osa(`tell application "Messages" to send "${text.replace(/"/g, '\\"')}" to buddy "${contact}" of (1st service whose service type = iMessage)`);
  },
  sendImage(contact, imagePath) {
    const resolved = resolvePath(imagePath);
    log('MESSAGES', `sendImage to ${contact}`);
    osa(`tell application "Messages" to send POSIX file "${resolved}" to buddy "${contact}" of (1st service whose service type = iMessage)`);
  },
  sendFile(contact, filePath) { messages.sendImage(contact, filePath); }
};

// ── MAIL ──
const mail = {
  send({ to, cc, subject, body, attachments }) {
    log('MAIL', `send to ${to}`);
    let script = `tell application "Mail"
      set newMsg to make new outgoing message with properties {subject:"${subject.replace(/"/g, '\\"')}", content:"${body.replace(/"/g, '\\"')}", visible:true}
      tell newMsg to make new to recipient with properties {address:"${to}"}
      ${cc ? `tell newMsg to make new cc recipient with properties {address:"${cc}"}` : ''}
      send newMsg
    end tell`;
    osa(script);
  },
  getUnread(count = 10) {
    try { return osa(`tell application "Mail" to get subject of (messages of inbox whose read status is false)`); }
    catch { return ''; }
  }
};

// ── FILES ──
const files = {
  read(p) { return fs.readFileSync(resolvePath(p), 'utf-8'); },
  readBinary(p) { return fs.readFileSync(resolvePath(p)); },
  write(p, content) {
    const resolved = resolvePath(p);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    log('FILES', `write ${resolved}`);
  },
  append(p, content) { fs.appendFileSync(resolvePath(p), content); },
  delete(p) {
    log('FILES', `delete ${p}`);
    osa(`tell application "Finder" to delete POSIX file "${resolvePath(p)}"`);
  },
  copy(src, dst) { execSync(`cp -r "${resolvePath(src)}" "${resolvePath(dst)}"`); },
  move(src, dst) { execSync(`mv "${resolvePath(src)}" "${resolvePath(dst)}"`); },
  list(dir, recursive = false) {
    const resolved = resolvePath(dir || '~');
    if (recursive) return execSync(`find "${resolved}" -maxdepth 3 -type f 2>/dev/null | head -100`, { timeout: 10000 }).toString().trim().split('\n');
    return fs.readdirSync(resolved).map(f => {
      const full = path.join(resolved, f);
      const stat = fs.statSync(full);
      return { name: f, path: full, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() };
    });
  },
  exists(p) { return fs.existsSync(resolvePath(p)); },
  getInfo(p) {
    const resolved = resolvePath(p);
    const stat = fs.statSync(resolved);
    return { path: resolved, size: stat.size, isDir: stat.isDirectory(), created: stat.birthtime.toISOString(), modified: stat.mtime.toISOString() };
  },
  open(p) { execSync(`open "${resolvePath(p)}"`); },
  openWith(p, app) { execSync(`open -a "${app}" "${resolvePath(p)}"`); },
  compress(paths, dst) {
    const resolved = paths.map(resolvePath).map(p => `"${p}"`).join(' ');
    execSync(`zip -r "${resolvePath(dst)}" ${resolved}`);
  },
  uploadToRemote(p) {
    const resolved = resolvePath(p);
    const fileId = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(resolved);
    const destPath = path.join(DOWNLOADS_DIR, `${fileId}${ext}`);
    fs.copyFileSync(resolved, destPath);
    fileRegistry.set(fileId, { path: destPath, originalName: path.basename(resolved), createdAt: Date.now() });
    log('FILES', `upload ${resolved} → ${fileId}`);
    return { fileId, url: `/remote/files/download/${fileId}`, originalName: path.basename(resolved) };
  },
  getDownload(fileId) { return fileRegistry.get(fileId) || null; },
  readImage(p) { return fs.readFileSync(resolvePath(p)).toString('base64'); }
};

// ── SYSTEM ──
const system = {
  runCommand(cmd, timeoutMs = 120000) {
    checkDangerous(cmd);
    log('SHELL', cmd.slice(0, 100));
    try {
      const stdout = execSync(cmd, { timeout: timeoutMs, shell: '/bin/zsh', encoding: 'utf-8' });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: e.stdout || '', stderr: e.stderr || e.message, exitCode: e.status || 1 };
    }
  },
  getRunningApps() {
    const result = osa('tell application "System Events" to get name of every process whose background only is false');
    return result.split(', ');
  },
  openApp(name) { log('APP', `open ${name}`); osa(`tell application "${name}" to activate`); },
  quitApp(name) { log('APP', `quit ${name}`); osa(`tell application "${name}" to quit`); },
  getFrontApp() { return osa('tell application "System Events" to get name of first process whose frontmost is true'); },
  getSystemInfo() {
    const cpu = execSync("top -l 1 | grep 'CPU usage' | head -1", { timeout: 10000, encoding: 'utf-8' }).trim();
    const memRaw = execSync("vm_stat | head -5", { timeout: 5000, encoding: 'utf-8' });
    const disk = execSync("df -h / | tail -1", { timeout: 5000, encoding: 'utf-8' }).trim();
    let battery = '';
    try { battery = execSync("pmset -g batt | grep -o '[0-9]*%'", { timeout: 3000, encoding: 'utf-8' }).trim(); } catch {}
    let wifi = '';
    try { wifi = execSync("networksetup -getairportnetwork en0 2>/dev/null | sed 's/.*: //'", { timeout: 3000, encoding: 'utf-8' }).trim(); } catch {}
    return { cpu, memory: memRaw, disk, battery, wifi };
  },
  speak(text, voice = 'Thomas') { exec(`say -v "${voice}" "${text.replace(/"/g, '\\"')}"`); },
  lock() { execSync('osascript -ss -e \'tell application "System Events" to keystroke "q" using {command down, control down}\''); },
  sleep() { exec('pmset sleepnow'); },
  notification(title, message, sound) {
    osa(`display notification "${(message||'').replace(/"/g, '\\"')}" with title "${(title||'').replace(/"/g, '\\"')}" ${sound ? `sound name "${sound}"` : ''}`);
  },
  clipboard: {
    read() { return execSync('pbpaste', { encoding: 'utf-8' }); },
    write(text) { execSync(`echo -n "${text.replace(/"/g, '\\"')}" | pbcopy`, { shell: '/bin/zsh' }); }
  }
};

// ── CLAUDE CODE ──
const claudeCode = {
  isRunning() { try { execSync('pgrep -x claude', { timeout: 3000 }); return true; } catch { return false; } },
  getActiveSessions() { try { return execSync("osascript -ss -e 'tell application \"Terminal\" to get name of every window'", { timeout: 5000, encoding: 'utf-8' }).trim(); } catch { return ''; } },
  startSession(projectPath) {
    const resolved = resolvePath(projectPath);
    log('CLAUDE_CODE', `start ${resolved}`);
    osa(`tell application "Terminal" to do script "cd '${resolved}' && claude"`);
  },
  sendCommand(cmd) {
    log('CLAUDE_CODE', `cmd: ${cmd.slice(0, 50)}`);
    osa(`tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}" in front window`);
  },
  getOutput() {
    try { return osa('tell application "Terminal" to get contents of front window'); }
    catch { return ''; }
  },
  validateRequest(responseType = '1') { claudeCode.sendCommand(responseType); },
  interruptSession() { keyboard.shortcut('cmd+c'); }
};

module.exports = {
  takeScreenshot, getScreenInfo, startScreenStream, stopScreenStream,
  camera, audio, mouse, keyboard, safari, messages, mail,
  files, system, claudeCode, log, fileRegistry,
  checkDangerous, resolvePath
};
