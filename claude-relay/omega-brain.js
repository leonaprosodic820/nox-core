const bridge = require('./claude-api-bridge');
const { compress } = require('./context-compressor');
const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, 'decisions');
fs.mkdirSync(DECISIONS_DIR, { recursive: true });

const OMEGA_SYSTEM = `OMEGA — autonomous AI project chief. Analyze input, decide next action.
Rules: [CC_START] present→send_to_claude_code | Options→decide_autonomously(choose best) | Question→decide_autonomously(answer) | Error→send_to_claude_code(fix) | Success→mark_complete
Return ONLY compact JSON:
{"decision":{"action":"send_to_claude_code|decide_autonomously|mark_complete|escalate|wait","reasoning":"2 sentences","confidence":0-100},"enhanced_payload":{"promptForClaudeCode":"improved prompt if send","autonomousAction":{"type":"choose_option|answer_question|fix_error","value":"exact value","reasoning":"why"}},"navigation":{"currentPhase":"planning|implementation|testing|complete","progressPercent":0-100,"nextMilestone":"next goal"}}`;

async function think(input, context = {}) {
  const startTime = Date.now();
  const { sessionId, instanceLabel = 'Main', projectMemory = {}, sessionHistory = [], iterationNumber = 0 } = context;

  const ctx = compress(context);
  const inputText = typeof input === 'string' ? input : JSON.stringify(input).slice(0, 2000);

  const userMsg = `[${instanceLabel}] It#${iterationNumber}\n${ctx ? 'CTX: ' + ctx + '\n' : ''}INPUT:\n${inputText}`;

  try {
    const response = await bridge.call(userMsg, { systemPrompt: OMEGA_SYSTEM, maxTokens: 1000, timeoutMs: 45000 });
    const result = bridge.parseJSON(response);
    if (!result.decision) result.decision = { action: 'wait', reasoning: 'No decision', confidence: 30 };
    if (!result.enhanced_payload) result.enhanced_payload = {};
    if (!result.navigation) result.navigation = { currentPhase: 'implementation', progressPercent: 0, nextMilestone: '' };
    result.meta = { processingMs: Date.now() - startTime, model: 'claude-max-cli', iterationNumber };
    logDecision(sessionId, instanceLabel, result);
    return result;
  } catch (e) {
    const fallback = buildFallback(inputText, e);
    fallback.meta = { processingMs: Date.now() - startTime, model: 'fallback', iterationNumber, error: e.message };
    logDecision(sessionId, instanceLabel, fallback);
    return fallback;
  }
}

function buildFallback(text, error) {
  const hasPrompt = /\[CC[-_]?START\]/i.test(text);
  const hasError = /error|erreur|failed/i.test(text);
  const hasConfirm = /completed|done|succès|✅/i.test(text);
  let action = 'wait', confidence = 30;
  if (hasPrompt) { action = 'send_to_claude_code'; confidence = 80; }
  else if (hasError) { action = 'decide_autonomously'; confidence = 60; }
  else if (hasConfirm) { action = 'mark_complete'; confidence = 70; }

  const promptMatch = text.match(/\[CC[-_]?START\]([\s\S]*?)\[CC[-_]?END\]/i);

  return {
    decision: { action, reasoning: `Fallback: ${error.message}`, confidence },
    enhanced_payload: promptMatch ? { promptForClaudeCode: promptMatch[1].trim() } : {},
    navigation: { currentPhase: 'implementation', progressPercent: 0, nextMilestone: '' }
  };
}

function logDecision(sessionId, label, result) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const entry = JSON.stringify({ timestamp: new Date().toISOString(), sessionId, label, action: result.decision?.action, confidence: result.decision?.confidence });
    fs.appendFileSync(path.join(DECISIONS_DIR, `${date}.jsonl`), entry + '\n');
  } catch {}
}

function getStatus() {
  return { available: bridge.isAvailable(), mode: bridge.isAvailable() ? 'claude-max-cli' : 'fallback', model: 'claude-max-cli' };
}

module.exports = { think, getStatus, OMEGA_SYSTEM, buildFallback };
