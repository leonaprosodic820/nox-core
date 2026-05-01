const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let macCmd;
try { macCmd = require('./mac-commander'); } catch { macCmd = null; }

async function gatherAll(input = {}) {
  const results = {};

  try { results.system = macCmd ? macCmd.system.getSystemInfo() : {}; } catch { results.system = {}; }
  try { results.openApps = macCmd ? macCmd.system.getRunningApps() : []; } catch { results.openApps = []; }

  results.environment = {
    nodeVersion: process.version, platform: process.platform, arch: process.arch,
    pid: process.pid, cwd: process.cwd(), uptime: process.uptime(), memory: process.memoryUsage()
  };

  results.relay = {
    sessions: countFiles(path.join(__dirname, 'sessions')),
    projects: countFiles(path.join(__dirname, 'projects')),
    decisions: countFiles(path.join(__dirname, 'decisions')),
    knowledge: getKnowledgeSize()
  };

  results.projectFiles = getProjectFiles();
  results.recentFiles = getRecentFiles();
  results.timestamp = new Date().toISOString();

  return { ...input, ...results };
}

function countFiles(dir) { try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')).length; } catch { return 0; } }

function getProjectFiles() {
  try { return fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !f.startsWith('.')); } catch { return []; }
}

function getRecentFiles() {
  try {
    return execSync('find ~/Desktop ~/Documents -newer ~/.zshrc -type f -not -name ".*" 2>/dev/null | head -10', { timeout: 5000, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch { return []; }
}

function getKnowledgeSize() {
  try {
    const kb = JSON.parse(fs.readFileSync(path.join(__dirname, 'knowledge', 'global.json'), 'utf-8'));
    return { successPatterns: kb.successPatterns?.length || 0, failurePatterns: kb.failurePatterns?.length || 0, errorSolutions: Object.keys(kb.errorSolutions || {}).length };
  } catch { return { successPatterns: 0, failurePatterns: 0, errorSolutions: 0 }; }
}

module.exports = { gatherAll, countFiles, getProjectFiles, getRecentFiles, getKnowledgeSize };
