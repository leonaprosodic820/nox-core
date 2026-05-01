'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const WORK_DIR = '/Users/shadowroot';

async function runClaudeCode(instruction, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', instruction, '--allowedTools', 'Bash,Read,Write,Edit', '--output-format', 'text'],
      { cwd: opts.cwd || WORK_DIR, timeout: opts.timeout || 120000, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => resolve({ success: code === 0, output: stdout.trim(), error: stderr.trim(), code }));
    proc.on('error', reject);
    setTimeout(() => { proc.kill('SIGTERM'); resolve({ success: false, output: stdout.trim(), error: 'Timeout', code: -1 }); }, opts.timeout || 120000);
  });
}

module.exports = { runClaudeCode, WORK_DIR };
