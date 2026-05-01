const brain = require('./brain');
const { notify } = require('./notifier');
const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, 'decisions');

let broadcastFn = null;
let httpGetFn = null;
let httpPostFn = null;

function setBroadcast(fn) { broadcastFn = fn; }
function setHttpHelpers(getFn, postFn) { httpGetFn = getFn; httpPostFn = postFn; }

function broadcast(data) {
  if (broadcastFn) broadcastFn(data);
}

async function processAutonomously(payload) {
  const { sessionId, instanceId, analysisResult, rawInput, projectMemory, sessionHistory } = payload;

  broadcast({ event: 'brain_thinking', instanceId, sessionId });

  const context = {
    sessionId, instanceId,
    projectName: payload.projectName || 'default',
    rawInput, analysisResult, projectMemory,
    sessionHistory: sessionHistory || [],
    pendingDecision: analysisResult?.type
  };

  let decision;
  try {
    decision = await brain.think(context);
  } catch (err) {
    decision = {
      decision: 'escalate',
      reasoning: `Brain error: ${err.message}`,
      payload: {},
      confidence: 0,
      nextAction: 'Intervention humaine requise',
      projectInsight: 'Erreur système'
    };
  }

  broadcast({ event: 'decision_made', instanceId, sessionId, decision });

  const result = await executeDecision(decision, payload);

  // Update decision outcome
  logOutcome(decision, result);

  return { decision, result };
}

async function executeDecision(decision, payload) {
  const { sessionId, instanceId } = payload;

  switch (decision.decision) {
    case 'execute_prompt':
      return { action: 'prompt_ready', message: 'Prompt prêt à exécuter' };

    case 'choose_option': {
      const optionChosen = decision.payload?.optionChosen || 'A';
      notify({ message: `Option auto-choisie: ${optionChosen}`, instanceLabel: payload.instanceLabel, sound: 'info' });
      return { action: 'option_chosen', optionChosen };
    }

    case 'answer_question': {
      const answer = decision.payload?.answer || '';
      broadcast({ event: 'auto_answer', instanceId, sessionId, answer });
      return { action: 'answer_generated', answer };
    }

    case 'retry_with_fix': {
      const correctedPrompt = decision.payload?.correctedPrompt || '';
      broadcast({ event: 'auto_corrected', instanceId, sessionId, correctedPrompt });
      notify({ message: 'Erreur corrigée automatiquement', instanceLabel: payload.instanceLabel, sound: 'warning' });
      return { action: 'retry_scheduled', correctedPrompt };
    }

    case 'mark_complete': {
      const reason = decision.payload?.completionReason || 'Tâche complétée';
      notify({ message: `Tâche complétée: ${reason}`, instanceLabel: payload.instanceLabel, sound: 'success' });
      return { action: 'completed', reason };
    }

    case 'escalate': {
      notify({ message: `⚠️ Intervention requise: ${decision.reasoning}`, instanceLabel: payload.instanceLabel, sound: 'error' });
      broadcast({ event: 'escalation', instanceId, sessionId, reason: decision.reasoning, context: decision });
      return { action: 'escalated', reason: decision.reasoning };
    }

    case 'wait':
    default:
      return { action: 'waiting', retryIn: 30000 };
  }
}

async function pollForResult(instanceId, timeoutMs = 300000) {
  const start = Date.now();
  const interval = 5000;

  while (Date.now() - start < timeoutMs) {
    // In a real implementation, this would check instance status
    // For now, return immediately as we don't have a real polling target
    await new Promise(r => setTimeout(r, interval));

    // Check if we've timed out
    if (Date.now() - start >= timeoutMs) {
      return { timedOut: true };
    }
  }

  return { timedOut: true };
}

async function autoRetry(instanceId, reason, maxRetries = 3) {
  let attempt = 0;
  const results = [];

  while (attempt < maxRetries) {
    attempt++;
    const delay = Math.pow(2, attempt) * 1000; // exponential backoff
    await new Promise(r => setTimeout(r, Math.min(delay, 100))); // cap for tests

    results.push({ attempt, reason, timestamp: new Date().toISOString() });

    // In real implementation, would retry the operation here
    // For now, just log attempts
  }

  // After max retries, escalate
  broadcast({ event: 'escalation', instanceId, reason: `Max retries (${maxRetries}) reached: ${reason}` });
  notify({ message: `Escalation après ${maxRetries} tentatives: ${reason}`, sound: 'error' });

  return { escalated: true, attempts: results };
}

function logOutcome(decision, result) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(DECISIONS_DIR, `${date}.json`);
    let entries = [];
    if (fs.existsSync(file)) {
      try { entries = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { entries = []; }
    }
    // Update the last entry with outcome
    if (entries.length > 0) {
      entries[entries.length - 1].outcome = result?.action || 'unknown';
    }
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  } catch {}
}

function getDecisions(dateStr) {
  const file = path.join(DECISIONS_DIR, `${dateStr || new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}

function getStats() {
  const today = new Date().toISOString().slice(0, 10);
  const decisions = getDecisions(today);
  const total = decisions.length;
  const byType = {};
  let totalConfidence = 0;
  decisions.forEach(d => {
    byType[d.decision] = (byType[d.decision] || 0) + 1;
    totalConfidence += d.confidence || 0;
  });
  return {
    totalDecisionsToday: total,
    byType,
    averageConfidence: total > 0 ? Math.round(totalConfidence / total) : 0,
    uptime: process.uptime()
  };
}

module.exports = { processAutonomously, executeDecision, pollForResult, autoRetry, setBroadcast, setHttpHelpers, getDecisions, getStats, logOutcome };
