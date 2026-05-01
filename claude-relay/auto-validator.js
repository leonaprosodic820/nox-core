const fs = require('fs');
const path = require('path');
const { notify } = require('./notifier');

const DECISIONS_DIR = path.join(__dirname, 'decisions');

let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }
function broadcast(data) { if (broadcastFn) broadcastFn(data); }

// Patterns that always get YES
const SAFE_PATTERNS = [
  /do you want to proceed\??/i,
  /continue\??/i,
  /confirm\??/i,
  /create file\??/i,
  /overwrite\??/i,
  /install package\??/i,
  /run command\??/i,
  /\[Y\/n\]/,
  /\[y\/N\]/,
  /\(yes\/no\)/i,
  /> 1\. Yes/,
  /Esc to cancel/,
];

// Patterns that always get NO + escalation
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /format disk/i,
  /drop\s+database/i,
  /delete\s+all\s+data/i,
  /sudo\s+rm/,
];

// Playwright specific
const PLAYWRIGHT_PATTERN = /playwright.*click|proceed with.*click/i;

function validateClaudeCodeRequest(request) {
  const text = typeof request === 'string' ? request : (request?.text || '');

  // Check dangerous first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      const result = { approved: false, response: 'no', reason: 'Destructive operation blocked', escalated: true };
      logValidation(text, result);
      broadcast({ event: 'auto_validated', request: text, decision: 'BLOCKED', reason: result.reason });
      notify({ message: '⚠️ Op\u00e9ration destructrice bloqu\u00e9e', sound: 'error' });
      broadcast({ event: 'escalation', reason: `Dangerous operation detected: ${text.slice(0, 100)}` });
      return result;
    }
  }

  // Check playwright - always option 2 (don't ask again)
  if (PLAYWRIGHT_PATTERN.test(text)) {
    const result = { approved: true, response: '2', reason: 'Playwright action auto-approved (don\'t ask again)' };
    logValidation(text, result);
    broadcast({ event: 'auto_validated', request: text, decision: 'YES', reason: result.reason });
    notify({ message: 'Auto-valid\u00e9: Playwright', sound: 'info' });
    return result;
  }

  // Check safe patterns
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(text)) {
      const response = generateYesResponse(text);
      const result = { approved: true, response, reason: `Auto-approved: ${pattern.source.slice(0, 30)}` };
      logValidation(text, result);
      broadcast({ event: 'auto_validated', request: text, decision: 'YES', reason: result.reason });
      notify({ message: `Auto-valid\u00e9: ${text.slice(0, 40)}`, sound: 'info' });
      return result;
    }
  }

  // Check for "Delete all?" without clear context
  if (/delete\s+all\??/i.test(text) && !DANGEROUS_PATTERNS.some(p => p.test(text))) {
    const result = { approved: false, response: 'no', reason: 'Delete all without clear context', escalated: false };
    logValidation(text, result);
    broadcast({ event: 'auto_validated', request: text, decision: 'NO', reason: result.reason });
    return result;
  }

  // Default: approve non-destructive
  const result = { approved: true, response: 'yes', reason: 'Default approval for non-destructive action' };
  logValidation(text, result);
  broadcast({ event: 'auto_validated', request: text, decision: 'YES', reason: result.reason });
  return result;
}

function generateYesResponse(requestType) {
  const text = typeof requestType === 'string' ? requestType : '';

  if (PLAYWRIGHT_PATTERN.test(text)) return '2';
  if (/\[Y\/n\]/.test(text)) return 'y';
  if (/\[y\/N\]/.test(text)) return 'y';
  if (/\(yes\/no\)/i.test(text)) return 'yes';
  if (/> 1\. Yes/.test(text)) return '1';
  if (/> 2\. Yes, and don't ask again/.test(text)) return '2';

  return 'yes';
}

function logValidation(request, result) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(DECISIONS_DIR, `validations-${date}.json`);
    let entries = [];
    if (fs.existsSync(file)) {
      try { entries = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { entries = []; }
    }
    entries.push({
      timestamp: new Date().toISOString(),
      request: request.slice(0, 200),
      approved: result.approved,
      response: result.response,
      reason: result.reason
    });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  } catch {}
}

module.exports = { validateClaudeCodeRequest, generateYesResponse, setBroadcast, logValidation, SAFE_PATTERNS, DANGEROUS_PATTERNS };
