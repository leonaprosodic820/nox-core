'use strict';
const { execSync } = require('child_process');
const sovereignty = require('./sovereignty-engine');

function run(cmd, timeout = 10000) {
  try { return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch (e) { return null; }
}
function apple(script, timeout = 10000) {
  const escaped = script.replace(/'/g, "'\\''");
  return run(`osascript -ss -e '${escaped}'`, timeout);
}

function launchApp(name) { const c = sovereignty.checkPermission('launch_app', { classification: 'CAUTION' }); if (!c.allowed) return { error: c.reason }; apple(`tell application "${name}" to activate`); sovereignty.auditLog('INFO', 'launch_app', name, 'CAUTION'); return { success: true, app: name }; }
function quitApp(name) { const c = sovereignty.checkPermission('quit_app', { classification: 'CAUTION' }); if (!c.allowed) return { error: c.reason }; apple(`tell application "${name}" to quit`); sovereignty.auditLog('INFO', 'quit_app', name, 'CAUTION'); return { success: true, app: name }; }
function listRunningApps() { const r = apple('tell application "System Events" to get name of every process whose background only is false'); return r ? r.split(', ').sort() : []; }
function sendNotification(title, message, subtitle) { const sub = subtitle ? `subtitle "${subtitle}"` : ''; apple(`display notification "${message}" with title "${title}" ${sub}`); return { success: true }; }
function openFolder(p) { const c = sovereignty.checkPermission('open_folder', { path: p, classification: 'SAFE' }); if (!c.allowed) return { error: c.reason }; run(`open "${p}"`); return { success: true, path: p }; }
function getDesktopFiles() { const r = run('ls -la ~/Desktop 2>/dev/null'); return r ? r.split('\n').slice(1) : []; }
function getDownloadsFiles() { const r = run('ls -lt ~/Downloads 2>/dev/null | head -20'); return r ? r.split('\n').slice(1) : []; }
function getNetworkInfo() { return { wifi: run("networksetup -getairportnetwork en0 2>/dev/null | awk -F': ' '{print $2}'") || 'N/A', ip_local: run('ipconfig getifaddr en0 2>/dev/null') || run('ipconfig getifaddr en1 2>/dev/null') || '?', ip_public: run('curl -s --max-time 5 https://api.ipify.org 2>/dev/null') || '?', dns: run("scutil --dns 2>/dev/null | grep nameserver | head -1 | awk '{print $3}'") || '?', ping_ms: run("ping -c 3 8.8.8.8 2>/dev/null | tail -1 | awk -F'/' '{print $5}'") || '?' }; }
function getMusicStatus() { const state = apple('tell application "Music" to get player state'); if (!state) return { error: 'Music non lancé' }; return { state, track: apple('tell application "Music" to get name of current track'), artist: apple('tell application "Music" to get artist of current track') }; }
function controlMusic(action) { const m = { play:'tell application "Music" to play', pause:'tell application "Music" to pause', next:'tell application "Music" to next track', previous:'tell application "Music" to previous track', stop:'tell application "Music" to stop' }; if (!m[action]) return { error: 'Action inconnue' }; apple(m[action]); return { success: true, action }; }
function getSpotifyStatus() { const state = apple('tell application "Spotify" to get player state'); if (!state) return { error: 'Spotify non lancé' }; return { state, track: apple('tell application "Spotify" to get name of current track'), artist: apple('tell application "Spotify" to get artist of current track') }; }
function controlSpotify(action) { const m = { play:'tell application "Spotify" to play', pause:'tell application "Spotify" to pause', next:'tell application "Spotify" to next track', previous:'tell application "Spotify" to previous track' }; if (!m[action]) return { error: 'Action inconnue' }; apple(m[action]); return { success: true, action }; }
function focusApp(name) { apple(`tell application "${name}" to activate`); return { success: true }; }
function minimizeApp(name) { apple(`tell application "System Events" to tell process "${name}" to set miniaturized of every window to true`); return { success: true }; }

function getCalendarEvents(days = 7) {
  try {
    const r = run(`osascript -ss -e 'tell application "Calendar" to set evts to {} & return & "END"'`, 15000);
    return r ? r.split('\n').filter(Boolean) : [];
  } catch (e) { return []; }
}

function getReminders() {
  try {
    const r = run(`osascript -ss -e 'tell application "Reminders" to get name of reminders of default list whose completed is false'`, 10000);
    return r ? r.split(', ') : [];
  } catch (e) { return []; }
}

function addReminder(title) {
  const c = sovereignty.checkPermission('add_reminder', { classification: 'SENSITIVE' });
  if (!c.allowed) return { error: c.reason };
  apple(`tell application "Reminders" to tell default list to make new reminder with properties {name:"${title}"}`);
  sovereignty.auditLog('INFO', 'add_reminder', title, 'SENSITIVE');
  return { success: true, title };
}

function searchContacts(query) {
  try {
    const r = run(`osascript -ss -e 'tell application "Contacts" to get name of every person whose name contains "${query}"'`, 10000);
    return r ? r.split(', ') : [];
  } catch (e) { return []; }
}

module.exports = { launchApp, quitApp, listRunningApps, sendNotification, openFolder, getDesktopFiles, getDownloadsFiles, getNetworkInfo, getMusicStatus, controlMusic, getSpotifyStatus, controlSpotify, focusApp, minimizeApp, getCalendarEvents, getReminders, addReminder, searchContacts };
