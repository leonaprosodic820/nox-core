const macCmd = require('./mac-commander');

const CLAUDE_URL = 'https://claude.ai';

function navigateToChat(path = '') {
  macCmd.safari.openURL(`${CLAUDE_URL}${path}`);
  // Wait for page to load
  const { execSync } = require('child_process');
  execSync('sleep 3');
}

function getAllSessions() {
  macCmd.log('CLAUDE_CHAT', 'getAllSessions');
  try {
    navigateToChat('/chats');
    macCmd.safari.waitForElement('[data-testid="conversation-turn"]', 8000);
    const json = macCmd.safari.executeJS(`
      JSON.stringify([...document.querySelectorAll('a[href*="/chat/"]')].map(a => ({
        title: a.textContent.trim(),
        href: a.getAttribute('href'),
        id: a.getAttribute('href').split('/').pop()
      })).filter(s => s.id))
    `);
    return JSON.parse(json || '[]');
  } catch { return []; }
}

function readSession(sessionId) {
  macCmd.log('CLAUDE_CHAT', `readSession ${sessionId}`);
  try {
    navigateToChat(`/chat/${sessionId}`);
    macCmd.safari.waitForElement('[data-testid="conversation-turn"]', 8000);
    const json = macCmd.safari.executeJS(`
      JSON.stringify([...document.querySelectorAll('[data-testid="conversation-turn"]')].map(el => ({
        role: el.querySelector('[data-testid="user-message"]') ? 'user' : 'assistant',
        content: el.innerText.trim()
      })))
    `);
    return JSON.parse(json || '[]');
  } catch { return []; }
}

function sendMessage(sessionId, message) {
  macCmd.log('CLAUDE_CHAT', `sendMessage to ${sessionId}`);
  try {
    navigateToChat(`/chat/${sessionId}`);
    macCmd.safari.waitForElement('[contenteditable]', 8000);
    // Focus and type
    macCmd.safari.executeJS(`
      const editor = document.querySelector('[contenteditable]');
      if (editor) { editor.focus(); editor.innerText = ''; }
    `);
    macCmd.keyboard.type(message);
    // Click send or press Enter
    const { execSync } = require('child_process');
    execSync('sleep 0.5');
    macCmd.keyboard.press('return');
    // Wait for response to complete (content stabilizes)
    execSync('sleep 5');
    let lastContent = '';
    for (let i = 0; i < 60; i++) { // max 5 min
      execSync('sleep 5');
      const current = macCmd.safari.executeJS('document.querySelector("[data-testid=\\"conversation-turn\\"]:last-child")?.innerText || ""');
      if (current === lastContent && current.length > 0) break;
      lastContent = current;
    }
    return lastContent;
  } catch (e) { return `Error: ${e.message}`; }
}

function createNewSession(message) {
  macCmd.log('CLAUDE_CHAT', 'createNewSession');
  try {
    navigateToChat('/new');
    const { execSync } = require('child_process');
    execSync('sleep 3');
    macCmd.safari.waitForElement('[contenteditable]', 8000);
    macCmd.safari.executeJS(`
      const editor = document.querySelector('[contenteditable]');
      if (editor) { editor.focus(); editor.innerText = ''; }
    `);
    macCmd.keyboard.type(message);
    execSync('sleep 0.5');
    macCmd.keyboard.press('return');
    execSync('sleep 5');
    const url = macCmd.safari.getCurrentURL();
    const sessionId = url.split('/').pop();
    return { sessionId, url };
  } catch (e) { return { sessionId: null, error: e.message }; }
}

function getAllProjects() {
  macCmd.log('CLAUDE_CHAT', 'getAllProjects');
  try {
    navigateToChat('/');
    const { execSync } = require('child_process');
    execSync('sleep 3');
    const json = macCmd.safari.executeJS(`
      JSON.stringify([...document.querySelectorAll('a[href*="/project/"]')].map(a => ({
        name: a.textContent.trim(),
        href: a.getAttribute('href'),
        id: a.getAttribute('href').split('/').pop()
      })).filter(p => p.id))
    `);
    return JSON.parse(json || '[]');
  } catch { return []; }
}

function readProject(projectId) {
  macCmd.log('CLAUDE_CHAT', `readProject ${projectId}`);
  try {
    navigateToChat(`/project/${projectId}`);
    const { execSync } = require('child_process');
    execSync('sleep 3');
    const content = macCmd.safari.readPageContent();
    return { id: projectId, content };
  } catch { return { id: projectId, content: '' }; }
}

function continueProject(projectId, instruction) {
  const project = readProject(projectId);
  // Find the last session in the project and send the instruction
  const sessions = getAllSessions();
  if (sessions.length > 0) {
    return sendMessage(sessions[0].id, instruction);
  }
  return createNewSession(instruction);
}

module.exports = { getAllSessions, readSession, sendMessage, createNewSession, getAllProjects, readProject, continueProject, navigateToChat };
