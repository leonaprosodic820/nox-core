'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_PATH = path.join(__dirname, 'knowledge', 'scheduled-tasks.json');
const MAX_ACTIVE = 20;
const MAX_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_HISTORY = 50;

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i, /\bsudo\s+rm\b/i, /\bmkfs\b/i, /\bdd\s+if=/i,
  /\bformat\b/i, /\bfdisk\b/i, /\bshutdown\b/i, /\breboot\b/i,
  /\bkill\s+-9\s+1\b/i, /\brm\s+\/\b/i, /\bchmod\s+777\b/i,
  /\bcurl.*\|\s*sh\b/i, /\bwget.*\|\s*bash\b/i, /\b:(){ :\|:& };:/
];

let tasks = {};
let history = [];
let timers = {};

function ensureStorage() {
  try {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  } catch (e) { /* ignore */ }
}

function loadTasks() {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    const data = JSON.parse(raw);
    tasks = data.tasks || {};
    history = data.history || [];
    // Don't restore timers - they are runtime only
  } catch (e) {
    tasks = {};
    history = [];
  }
}

function saveTasks() {
  try {
    ensureStorage();
    fs.writeFileSync(STORAGE_PATH, JSON.stringify({ tasks, history, lastSaved: new Date().toISOString() }, null, 2));
  } catch (e) { /* ignore */ }
}

function isDangerous(instruction) {
  const lower = (instruction || '').toLowerCase();
  return DANGEROUS_PATTERNS.some(p => p.test(lower));
}

async function compileTask(instruction) {
  if (!instruction || typeof instruction !== 'string') {
    return { error: 'Instruction required' };
  }

  if (isDangerous(instruction)) {
    return { error: 'REFUSED: Dangerous command detected', instruction };
  }

  const activeCount = Object.values(tasks).filter(t => t.status === 'active').length;
  if (activeCount >= MAX_ACTIVE) {
    return { error: `Maximum ${MAX_ACTIVE} active tasks reached` };
  }

  try {
    const { callFast } = require('./claude-api-bridge');

    const systemPrompt = `Parse the following natural language instruction into a scheduled task.
Return ONLY valid JSON:
{
  "trigger": "description of when to execute",
  "action": "what to do",
  "repeat": false,
  "intervalMs": null,
  "delayMs": 5000,
  "priority": "normal",
  "summary": "one line summary"
}
- repeat: true if recurring, false if one-shot
- intervalMs: milliseconds between repeats (null if one-shot). Max 604800000 (7 days).
- delayMs: milliseconds before first execution. Min 1000.
- priority: "low", "normal", "high", or "critical"`;

    const raw = await callFast(instruction, { systemPrompt, maxTokens: 500, timeoutMs: 15000 });

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      parsed = null;
    }

    if (!parsed) {
      return { error: 'Failed to parse instruction', raw };
    }

    // Enforce limits
    if (parsed.intervalMs && parsed.intervalMs > MAX_EXPIRY_MS) {
      parsed.intervalMs = MAX_EXPIRY_MS;
    }
    if (parsed.delayMs && parsed.delayMs < 1000) {
      parsed.delayMs = 1000;
    }

    const taskId = crypto.randomBytes(8).toString('hex');
    const task = {
      id: taskId,
      instruction,
      trigger: parsed.trigger || 'manual',
      action: parsed.action || instruction,
      repeat: parsed.repeat || false,
      intervalMs: parsed.intervalMs || null,
      delayMs: parsed.delayMs || 5000,
      priority: parsed.priority || 'normal',
      summary: parsed.summary || instruction.slice(0, 80),
      status: 'pending',
      requiresConfirmation: true,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + MAX_EXPIRY_MS).toISOString()
    };

    tasks[taskId] = task;
    saveTasks();

    return { ...task, message: 'Task compiled. Call confirmTask(taskId) to activate.' };
  } catch (err) {
    return { error: err.message };
  }
}

function executeTask(taskId) {
  const task = tasks[taskId];
  if (!task || task.status !== 'active') return;

  const execution = {
    taskId,
    summary: task.summary,
    executedAt: new Date().toISOString(),
    status: 'executed'
  };

  history.push(execution);
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  if (!task.repeat) {
    task.status = 'completed';
    if (timers[taskId]) {
      clearTimeout(timers[taskId]);
      delete timers[taskId];
    }
  }

  saveTasks();
  return execution;
}

function confirmTask(taskId) {
  const task = tasks[taskId];
  if (!task) return { error: 'Task not found' };
  if (task.status === 'active') return { error: 'Task already active' };

  task.status = 'active';
  task.activatedAt = new Date().toISOString();

  // Set up timer
  if (task.repeat && task.intervalMs) {
    timers[taskId] = setInterval(() => executeTask(taskId), task.intervalMs);
  } else {
    timers[taskId] = setTimeout(() => executeTask(taskId), task.delayMs || 5000);
  }

  saveTasks();
  return { ...task, message: 'Task activated' };
}

function listTasks() {
  return Object.values(tasks).map(t => ({
    id: t.id,
    summary: t.summary,
    status: t.status,
    priority: t.priority,
    repeat: t.repeat,
    createdAt: t.createdAt
  }));
}

function cancelTask(id) {
  const task = tasks[id];
  if (!task) return { error: 'Task not found' };

  if (timers[id]) {
    if (task.repeat) clearInterval(timers[id]);
    else clearTimeout(timers[id]);
    delete timers[id];
  }

  task.status = 'cancelled';
  saveTasks();
  return { id, status: 'cancelled' };
}

function pauseTask(id) {
  const task = tasks[id];
  if (!task) return { error: 'Task not found' };
  if (task.status !== 'active') return { error: 'Task not active' };

  if (timers[id]) {
    if (task.repeat) clearInterval(timers[id]);
    else clearTimeout(timers[id]);
    delete timers[id];
  }

  task.status = 'paused';
  saveTasks();
  return { id, status: 'paused' };
}

function resumeTask(id) {
  const task = tasks[id];
  if (!task) return { error: 'Task not found' };
  if (task.status !== 'paused') return { error: 'Task not paused' };

  task.status = 'active';

  if (task.repeat && task.intervalMs) {
    timers[id] = setInterval(() => executeTask(id), task.intervalMs);
  } else {
    timers[id] = setTimeout(() => executeTask(id), task.delayMs || 5000);
  }

  saveTasks();
  return { id, status: 'active' };
}

function getHistory() {
  return history.slice(-MAX_HISTORY);
}

// Load on require
loadTasks();

module.exports = { compileTask, confirmTask, listTasks, cancelTask, pauseTask, resumeTask, getHistory };
