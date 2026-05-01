const macCmd = require('./mac-commander');
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'nl-history.json');

let superBrain = null;
try { superBrain = require('./super-brain'); } catch {}

const FUNCTION_MAP = {
  'takeScreenshot': () => ({ image: macCmd.takeScreenshot().toString('base64') }),
  'safari.openURL': (args) => { macCmd.safari.openURL(args.url); return { success: true }; },
  'safari.getCurrentURL': () => ({ url: macCmd.safari.getCurrentURL() }),
  'safari.readPageContent': () => ({ content: macCmd.safari.readPageContent() }),
  'safari.executeJS': (args) => ({ result: macCmd.safari.executeJS(args.code) }),
  'safari.click': (args) => { macCmd.safari.click(args.selector); return { success: true }; },
  'safari.fillForm': (args) => { macCmd.safari.fillForm(args.selector, args.value); return { success: true }; },
  'files.read': (args) => ({ content: macCmd.files.read(args.path) }),
  'files.write': (args) => { macCmd.files.write(args.path, args.content); return { success: true }; },
  'files.list': (args) => ({ files: macCmd.files.list(args.path || '~') }),
  'files.delete': (args) => { macCmd.files.delete(args.path); return { success: true }; },
  'files.uploadToRemote': (args) => macCmd.files.uploadToRemote(args.path),
  'system.runCommand': (args) => macCmd.system.runCommand(args.command),
  'system.getRunningApps': () => ({ apps: macCmd.system.getRunningApps() }),
  'system.openApp': (args) => { macCmd.system.openApp(args.name); return { success: true }; },
  'system.speak': (args) => { macCmd.system.speak(args.text, args.voice); return { success: true }; },
  'system.clipboard.read': () => ({ text: macCmd.system.clipboard.read() }),
  'system.clipboard.write': (args) => { macCmd.system.clipboard.write(args.text); return { success: true }; },
  'system.getSystemInfo': () => macCmd.system.getSystemInfo(),
  'camera.takePicture': () => ({ image: macCmd.camera.takePicture().toString('base64') }),
  'audio.startRecording': (args) => ({ path: macCmd.audio.startRecording(args.duration || 10) }),
  'messages.sendText': (args) => { macCmd.messages.sendText(args.contact, args.text); return { success: true }; },
  'messages.sendImage': (args) => { macCmd.messages.sendImage(args.contact, args.imagePath); return { success: true }; },
  'mail.send': (args) => { macCmd.mail.send(args); return { success: true }; },
  'mail.getUnread': () => ({ mails: macCmd.mail.getUnread() }),
  'mouse.click': (args) => { macCmd.mouse.click(args.x, args.y, args.button); return { success: true }; },
  'keyboard.type': (args) => { macCmd.keyboard.type(args.text); return { success: true }; },
  'keyboard.shortcut': (args) => { macCmd.keyboard.shortcut(args.combo); return { success: true }; },
  'claudeCode.isRunning': () => ({ running: macCmd.claudeCode.isRunning() }),
  'claudeCode.startSession': (args) => { macCmd.claudeCode.startSession(args.projectPath); return { success: true }; },
  'claudeCode.sendCommand': (args) => { macCmd.claudeCode.sendCommand(args.command); return { success: true }; },
  'claudeCode.getOutput': () => ({ output: macCmd.claudeCode.getOutput() }),
  'system.lock': () => { macCmd.system.lock(); return { success: true }; },
  'system.notification': (args) => { macCmd.system.notification(args.title, args.message); return { success: true }; },
  'getScreenInfo': () => macCmd.getScreenInfo(),
};

// Simple keyword-based intent detection (fallback without API)
function detectIntent(order) {
  const lower = order.toLowerCase();

  if (/screenshot|capture|écran|screen/.test(lower)) return { fn: 'takeScreenshot', args: {} };
  if (/photo|caméra|camera/.test(lower)) return { fn: 'camera.takePicture', args: {} };
  if (/clipboard|presse-?papier|copier/.test(lower)) return { fn: 'system.clipboard.read', args: {} };
  if (/status|état|info.*mac|système/.test(lower)) return { fn: 'system.getSystemInfo', args: {} };
  if (/lock|verrouill/.test(lower)) return { fn: 'system.lock', args: {} };
  if (/claude.*code.*running|claude.*actif/.test(lower)) return { fn: 'claudeCode.isRunning', args: {} };
  if (/apps?.*active|running.*apps?|application/.test(lower)) return { fn: 'system.getRunningApps', args: {} };

  // Safari
  const urlMatch = lower.match(/(?:ouvr|open|go|safari).*?(https?:\/\/\S+|[\w.-]+\.\w{2,})/i);
  if (urlMatch) {
    let url = urlMatch[1];
    if (!url.startsWith('http')) url = 'https://' + url;
    return { fn: 'safari.openURL', args: { url } };
  }

  // Files
  const readMatch = lower.match(/(?:li[rs]|read|cat).*?(?:fichier|file)?\s+([\w~\/.-]+)/);
  if (readMatch) return { fn: 'files.read', args: { path: readMatch[1] } };

  const listMatch = lower.match(/(?:list|ls|affiche|montre).*?(?:fichiers?|dossier|folder|dir)?\s*([\w~\/.-]*)/);
  if (listMatch) return { fn: 'files.list', args: { path: listMatch[1] || '~/Desktop' } };

  // Shell
  const execMatch = lower.match(/(?:exécute|execute|run|lance)\s+(.+)/);
  if (execMatch) return { fn: 'system.runCommand', args: { command: execMatch[1] } };

  // Messages
  const msgMatch = lower.match(/(?:envoie|send|dit?s?\s+[àa])\s+(?:à\s+)?(\w+)\s+(?:que\s+|par\s+messages?\s+)?(.+)/i);
  if (msgMatch) return { fn: 'messages.sendText', args: { contact: msgMatch[1], text: msgMatch[2] } };

  // Speak
  const speakMatch = lower.match(/(?:dis|say|parle|speak)\s+"?(.+)"?/);
  if (speakMatch) return { fn: 'system.speak', args: { text: speakMatch[1] } };

  return null;
}

async function interpretAndExecute(order, onStep) {
  const orderId = Date.now().toString(36);
  const results = [];

  macCmd.log('NL_COMMAND', order.slice(0, 100));
  if (onStep) onStep({ orderId, step: 'analyzing', description: 'Analyzing order...' });

  // Check for dangerous commands
  if (/rm\s+-rf\s+\/|format\s+disk|mkfs|dd\s+if=\/dev\/zero/i.test(order)) {
    const result = { orderId, success: false, error: 'Dangerous command blocked', results: [] };
    saveHistory(order, result);
    return result;
  }

  // Try simple detection first
  const simple = detectIntent(order);
  if (simple) {
    if (onStep) onStep({ orderId, step: 'executing', description: `Executing ${simple.fn}...` });
    try {
      const fn = FUNCTION_MAP[simple.fn];
      if (fn) {
        const r = fn(simple.args);
        results.push({ step: simple.fn, result: r });
      }
    } catch (e) {
      results.push({ step: simple.fn, error: e.message });
    }
  } else {
    // Fallback: try to use super-brain if available
    if (superBrain && superBrain.isAvailable().available) {
      // Would use API to interpret - for now, return unknown
      if (onStep) onStep({ orderId, step: 'unknown', description: 'Order not recognized. Try being more specific.' });
      results.push({ step: 'unknown', error: 'Could not interpret order. Try: screenshot, status, lock, open safari, etc.' });
    } else {
      results.push({ step: 'unknown', error: 'Order not recognized. Available: screenshot, camera, status, lock, clipboard, open [url], run [command]' });
    }
  }

  const finalResult = {
    orderId,
    order,
    success: results.every(r => !r.error),
    results,
    timestamp: new Date().toISOString()
  };

  if (onStep) onStep({ orderId, step: 'complete', description: 'Done', results });
  saveHistory(order, finalResult);
  return finalResult;
}

function saveHistory(order, result) {
  try {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { history = []; }
    }
    history.push({ order, result: { success: result.success, timestamp: result.timestamp }, timestamp: new Date().toISOString() });
    if (history.length > 100) history = history.slice(-100);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch {}
}

function getHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); }
  catch { return []; }
}

function getAvailableFunctions() { return Object.keys(FUNCTION_MAP); }

module.exports = { interpretAndExecute, detectIntent, getHistory, getAvailableFunctions, FUNCTION_MAP, saveHistory };
