'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EMAIL_LOG = path.join(__dirname, 'knowledge', 'email-log.json');
fs.mkdirSync(path.dirname(EMAIL_LOG), { recursive: true });

function getUnreadEmails(max = 10) {
  try {
    const script = `tell application "Mail"
set unread to (every message of inbox whose read status is false)
set result to ""
set counter to 0
repeat with m in unread
if counter >= ${max} then exit repeat
set result to result & (sender of m) & "||" & (subject of m) & "||" & ((date sent of m) as string) & "||" & (text 1 thru (min of {500, length of (content of m)}) of (content of m)) & "|||"
set counter to counter + 1
end repeat
return result
end tell`;
    const raw = execSync('osascript -ss -e \'' + script.replace(/'/g, "'\\''") + '\'', { encoding: 'utf8', timeout: 15000 }).trim();
    if (!raw) return [];
    return raw.split('|||').filter(Boolean).map(line => { const p = line.split('||'); return { from: p[0]||'?', subject: p[1]||'?', date: p[2]||'?', preview: p[3]||'' }; });
  } catch (e) { return []; }
}

async function generateDraft(email, context = '') {
  const bridge = require('./claude-api-bridge');
  try {
    const resp = await bridge.callFast(`Tu es l'assistant de l'utilisateur. Email reçu:\nDe: ${email.from}\nSujet: ${email.subject}\nContenu: ${email.preview}\n${context?'Contexte: '+context:''}\n\nGénère une réponse professionnelle, concise, en français. Corps uniquement.`, { maxTokens: 500 });
    return typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
  } catch (e) { return null; }
}

function saveDraft(email, draft) {
  let log = []; try { log = JSON.parse(fs.readFileSync(EMAIL_LOG, 'utf8')); } catch (e) {}
  const entry = { id: Date.now().toString(), email, draft, status: 'pending', createdAt: new Date().toISOString() };
  log.unshift(entry); if (log.length > 100) log.pop();
  fs.writeFileSync(EMAIL_LOG, JSON.stringify(log, null, 2));
  return entry;
}

function getDrafts(status = 'pending') { try { return JSON.parse(fs.readFileSync(EMAIL_LOG, 'utf8')).filter(e => e.status === status); } catch (e) { return []; } }

function updateDraftStatus(id, status) {
  try { const log = JSON.parse(fs.readFileSync(EMAIL_LOG, 'utf8')); const e = log.find(x => x.id === id); if (e) { e.status = status; e.updatedAt = new Date().toISOString(); fs.writeFileSync(EMAIL_LOG, JSON.stringify(log, null, 2)); } return e; }
  catch (e) { return null; }
}

function sendEmail(to, subject, body) {
  try {
    const script = `tell application "Mail"
set newMsg to make new outgoing message with properties {subject:"${subject.replace(/"/g,'\\"')}", content:"${body.replace(/"/g,'\\"')}", visible:false}
tell newMsg to make new to recipient with properties {address:"${to}"}
send newMsg
end tell`;
    execSync('osascript -ss -e \'' + script.replace(/'/g, "'\\''") + '\'', { encoding: 'utf8', timeout: 15000 });
    return { success: true };
  } catch (e) { return { error: e.message }; }
}

module.exports = { getUnreadEmails, generateDraft, saveDraft, getDrafts, updateDraftStatus, sendEmail };
