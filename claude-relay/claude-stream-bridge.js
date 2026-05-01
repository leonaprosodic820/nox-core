'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function callStreaming(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const {
      systemPrompt = '',
      maxTokens = 2000,
      onToken = () => {},
      onDone = () => {},
      onError = () => {},
      model = null,
    } = opts;

    const args = ['-p', '--output-format', 'text'];
    if (model) args.push('--model', model);

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const fullPrompt = systemPrompt
      ? `[System: ${systemPrompt.slice(0, 2000)}]\n\n${prompt}`
      : prompt;

    claude.stdin.write(fullPrompt);
    claude.stdin.end();

    let fullResponse = '';
    let buffer = '';
    let tokenCount = 0;

    claude.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      fullResponse += text;
      buffer += text;

      const words = buffer.split(/(?<=\s)/);
      if (words.length > 1) {
        buffer = words.pop();
        const toSend = words.join('');
        if (toSend) {
          tokenCount += Math.ceil(toSend.length / 4);
          onToken(toSend);
        }
      }
    });

    claude.stdout.on('end', () => {
      if (buffer) {
        onToken(buffer);
      }
      onDone(fullResponse.trim());
      resolve(fullResponse.trim());
    });

    claude.stderr.on('data', chunk => {
      const msg = chunk.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        onError(msg);
      }
    });

    claude.on('error', e => { onError(e.message); reject(e); });

    claude.on('close', code => {
      if (code !== 0 && !fullResponse) {
        const err = `Claude CLI exit code: ${code}`;
        onError(err);
        reject(new Error(err));
      }
    });

    const timeout = setTimeout(() => {
      claude.kill('SIGTERM');
      onError('Timeout 90s');
      reject(new Error('Timeout'));
    }, 90000);

    claude.on('close', () => clearTimeout(timeout));
  });
}

module.exports = { callStreaming };
