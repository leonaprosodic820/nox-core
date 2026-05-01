const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const kb = require('./knowledge-base');

let bridge;
try { bridge = require('./claude-api-bridge'); } catch { bridge = null; }

async function heal(error, context = {}) {
  const errMsg = typeof error === 'string' ? error : (error?.message || String(error));

  const knownSolution = kb.findSolution(errMsg);
  if (knownSolution) return { healed: true, solution: knownSolution, fromKnowledgeBase: true };

  if (bridge && bridge.isAvailable()) {
    try {
      const response = await bridge.call(
        `Error to diagnose and fix:\n${errMsg}\nStack: ${error?.stack?.slice(0,300) || 'N/A'}\n\nReturn JSON: {"errorType":"runtime|network|permission|logic|resource","rootCause":"...","shellCommand":"command or null","permanentFix":"...","canSelfHeal":bool,"severity":"low|medium|high|critical"}`,
        { timeoutMs: 30000 }
      );
      const diagnosis = bridge.parseJSON(response);

      if (diagnosis.canSelfHeal && diagnosis.shellCommand) {
        try { execSync(diagnosis.shellCommand, { timeout: 15000 }); } catch {}
      }
      if (diagnosis.permanentFix) kb.addErrorSolution(errMsg, diagnosis.permanentFix);

      return { healed: diagnosis.canSelfHeal, diagnosis };
    } catch {}
  }

  return { healed: false, diagnosis: { rootCause: errMsg, canSelfHeal: false } };
}

async function runDiagnostic() {
  const checks = [
    { name: 'Claude CLI', cmd: 'which claude' },
    { name: 'Node.js', cmd: 'node --version' },
    { name: 'FFmpeg', cmd: 'ffmpeg -version 2>&1 | head -1' },
    { name: 'Disk Space', cmd: 'df -h / | tail -1' },
    { name: 'Memory', cmd: 'vm_stat | head -3' },
  ];

  const results = {};
  for (const check of checks) {
    try {
      const out = execSync(check.cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
      results[check.name] = { ok: true, output: out.slice(0, 80) };
    } catch (e) {
      results[check.name] = { ok: false, error: e.message.slice(0, 80) };
    }
  }
  return results;
}

async function getCurrentState() {
  return { memory: process.memoryUsage(), uptime: process.uptime(), pid: process.pid, diagnostic: await runDiagnostic() };
}

module.exports = { heal, runDiagnostic, getCurrentState };
