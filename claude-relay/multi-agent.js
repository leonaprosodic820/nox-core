'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const crypto = require('crypto');

const LIMITS = {
  MAX_TOKENS_PER_MISSION: 80000,
  MAX_TOKENS_PER_STEP: 6000,
  MAX_STEPS: 25,
  MAX_CONCURRENT_MISSIONS: 3,
  STEP_TIMEOUT_MS: 90000,
  MISSION_TIMEOUT_MS: 3600000,
  MAX_RETRIES_PER_STEP: 3,
  CHECKPOINT_EVERY_N_STEPS: 3,
  MIN_CONFIDENCE_TO_PROCEED: 55,
};

const STEP_TYPES = {
  research: '🔍', code: '💻', file: '📁', shell: '⚡',
  verify: '✅', deploy: '🚀', test: '🧪', analyze: '🔬',
};

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i, /rm\s+-r/i, /delete\s+from/i, /drop\s+(table|database)/i,
  /format\s+(disk|drive)/i, /diskutil\s+erase/i, /overwrite/i, /truncate\s+table/i,
  /git\s+reset\s+--hard/i, /git\s+push\s+--force/i, /sudo\s+rm/i, /wipe/i, /shred/i,
];

const STATES = {
  PLANNING: 'PLANNING', AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  RUNNING: 'RUNNING', PAUSED: 'PAUSED', AWAITING_CONFIRM: 'AWAITING_CONFIRM',
  COMPLETED: 'COMPLETED', FAILED: 'FAILED', KILLED: 'KILLED', ROLLED_BACK: 'ROLLED_BACK',
};

const LOG_DIR = path.join(__dirname, 'knowledge', 'missions');
fs.mkdirSync(LOG_DIR, { recursive: true });

class MissionLogger {
  constructor(missionId) {
    this.missionId = missionId;
    this.logPath = path.join(LOG_DIR, `${missionId}.json`);
    this.entries = [];
    try { this.entries = JSON.parse(fs.readFileSync(this.logPath, 'utf8')); } catch {}
  }
  log(event, data = {}) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    this.entries.push(entry);
    try { fs.writeFileSync(this.logPath, JSON.stringify(this.entries, null, 2)); } catch {}
    return entry;
  }
  getAll() { return this.entries; }
}

class Mission extends EventEmitter {
  constructor(objective, plan, opts = {}) {
    super();
    this.id = 'M-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    this.objective = objective;
    this.title = plan.title;
    this.complexity = plan.complexity;
    this.steps = plan.steps;
    this.risks = plan.risks || [];
    this.state = STATES.AWAITING_APPROVAL;
    this.currentStep = 0;
    this.tokensUsed = 0;
    this.results = [];
    this.startedAt = null;
    this.completedAt = null;
    this.killSwitch = false;
    this.pausePromise = null;
    this.pauseResolve = null;
    this.pendingConfirm = null;
    this.logger = new MissionLogger(this.id);
    this._timeout = null;
    this.logger.log('CREATED', { objective, title: plan.title, steps: plan.steps.length });
  }

  start() {
    if (this.state !== STATES.AWAITING_APPROVAL) throw new Error('Pas en attente');
    this.state = STATES.RUNNING;
    this.startedAt = Date.now();
    this._timeout = setTimeout(() => {
      if ([STATES.RUNNING, STATES.PAUSED].includes(this.state)) this.kill('Timeout global (1h)');
    }, LIMITS.MISSION_TIMEOUT_MS);
    this.logger.log('STARTED');
  }

  kill(reason = 'Kill switch') {
    this.killSwitch = true;
    this.state = STATES.KILLED;
    if (this._timeout) clearTimeout(this._timeout);
    if (this.pauseResolve) this.pauseResolve(false);
    if (this.pendingConfirm) this.pendingConfirm(false);
    this.logger.log('KILLED', { reason });
    this.emit('killed', { reason });
  }

  pause() {
    if (this.state !== STATES.RUNNING) return;
    this.state = STATES.PAUSED;
    this.pausePromise = new Promise(resolve => { this.pauseResolve = resolve; });
    this.logger.log('PAUSED', { step: this.currentStep });
  }

  resume() {
    if (this.state !== STATES.PAUSED) return;
    this.state = STATES.RUNNING;
    if (this.pauseResolve) { this.pauseResolve(true); this.pauseResolve = null; }
    this.logger.log('RESUMED', { step: this.currentStep });
    this.emit('resumed');
  }

  async waitIfPaused() {
    if (this.state === STATES.PAUSED && this.pausePromise) await this.pausePromise;
  }

  async requestConfirmation(question, data = {}) {
    this.state = STATES.AWAITING_CONFIRM;
    this.logger.log('AWAITING_CONFIRM', { question, ...data });
    this.emit('confirm_required', { question, ...data });
    const confirmed = await new Promise(resolve => {
      this.pendingConfirm = resolve;
      setTimeout(() => resolve(false), 300000);
    });
    this.state = STATES.RUNNING;
    this.pendingConfirm = null;
    this.logger.log('CONFIRMATION', { confirmed, question });
    return confirmed;
  }

  confirm(approved) { if (this.pendingConfirm) this.pendingConfirm(approved); }

  getStatus() {
    const elapsed = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    return {
      id: this.id, title: this.title, objective: this.objective, complexity: this.complexity,
      state: this.state, currentStep: this.currentStep, totalSteps: this.steps.length,
      tokensUsed: this.tokensUsed, tokenBudget: LIMITS.MAX_TOKENS_PER_MISSION,
      tokenPct: Math.round((this.tokensUsed / LIMITS.MAX_TOKENS_PER_MISSION) * 100),
      progress: this.steps.length > 0 ? Math.round((this.currentStep / this.steps.length) * 100) : 0,
      elapsed, results: this.results, risks: this.risks,
    };
  }
}

async function planMission(objective) {
  const bridge = require('./claude-api-bridge');
  const resp = await bridge.callFast(`Tu es l'Agent Planificateur de PROMETHEUS. Cree un plan d'execution precis et sur.
OBJECTIF: "${objective}"
CONTEXTE: macOS, Claude Code CLI, fichiers /Users/shadowroot/, terminal, APIs externes. Budget: ${LIMITS.MAX_TOKENS_PER_MISSION} tokens, timeout 60min.
TYPES: research, code, file, shell, verify, deploy, test, analyze. Max ${LIMITS.MAX_STEPS} etapes.
Reponds UNIQUEMENT en JSON:
{"title":"Titre court","complexity":"simple|medium|complex","feasible":true,"feasibilityNote":"","estimatedTokens":15000,"estimatedMinutes":10,"steps":[{"id":1,"title":"Titre","description":"Description actionnable","type":"research","destructive":false,"requiresConfirmation":false,"rollback":"Comment annuler","expectedOutput":"Resultat attendu","estimatedTokens":1000}],"risks":["risque"],"questions":[]}`, { maxTokens: 3000 });
  const raw = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json\n?|```\n?/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Plan JSON invalide');
  const plan = JSON.parse(match[0]);
  if (!plan.steps || !Array.isArray(plan.steps)) throw new Error('Plan invalide: pas d\'etapes');
  if (plan.steps.length > LIMITS.MAX_STEPS) plan.steps = plan.steps.slice(0, LIMITS.MAX_STEPS);
  if (plan.estimatedTokens > LIMITS.MAX_TOKENS_PER_MISSION) throw new Error(`Mission trop lourde: ${plan.estimatedTokens} tokens`);
  return plan;
}

async function executeStep(mission, step, previousResults) {
  if (mission.killSwitch) throw new Error('Kill switch actif');
  await mission.waitIfPaused();
  const remaining = LIMITS.MAX_TOKENS_PER_MISSION - mission.tokensUsed;
  if (remaining < 500) throw new Error('Budget tokens epuise');

  if (step.destructive || step.requiresConfirmation) {
    const confirmed = await mission.requestConfirmation(`Etape destructive: "${step.title}"\n${step.description}`, { step: step.id, rollback: step.rollback });
    if (!confirmed) throw new Error(`Etape ${step.id} refusee`);
  }

  if (DESTRUCTIVE_PATTERNS.some(p => p.test(step.description)) && !step.destructive) {
    step.destructive = true;
    const confirmed = await mission.requestConfirmation(`Commande dangereuse detectee: "${step.title}"`, { step: step.id });
    if (!confirmed) throw new Error('Commande dangereuse refusee');
  }

  const bridge = require('./claude-api-bridge');
  const context = previousResults.slice(-5).map(r => `[Etape ${r.stepId}] ${r.summary}`).join('\n');
  const prompt = `MISSION PROMETHEUS — ETAPE ${step.id}/${mission.steps.length}
Objectif: "${mission.objective}"
Historique: ${context || 'Premiere etape'}
Titre: ${step.title} | Type: ${step.type}
Description: ${step.description}
Resultat attendu: ${step.expectedOutput}
Execute precisement. Sois concis.`;

  const result = await Promise.race([
    (async () => {
      if (['shell', 'code', 'file', 'deploy'].includes(step.type)) {
        try {
          const ccBridge = require('./claude-code-bridge');
          return await ccBridge.runClaudeCode(prompt, { cwd: '/Users/shadowroot', timeout: LIMITS.STEP_TIMEOUT_MS });
        } catch {
          const r = await bridge.callFast(prompt, { maxTokens: Math.min(LIMITS.MAX_TOKENS_PER_STEP, remaining) });
          return { success: true, output: typeof r === 'string' ? r : r.content?.[0]?.text || '' };
        }
      }
      const r = await bridge.callFast(prompt, { maxTokens: Math.min(LIMITS.MAX_TOKENS_PER_STEP, remaining) });
      return { success: true, output: typeof r === 'string' ? r : r.content?.[0]?.text || '' };
    })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout etape')), LIMITS.STEP_TIMEOUT_MS)),
  ]);

  mission.tokensUsed += Math.round((prompt.length + (result.output?.length || 0)) / 3.5);
  mission.logger.log('STEP_EXECUTED', { step: step.id, totalTokens: mission.tokensUsed });
  return result;
}

async function verifyStep(mission, step, result) {
  const bridge = require('./claude-api-bridge');
  try {
    const resp = await bridge.callFast(`Verifie cette etape. Etape: ${step.title} Attendu: ${step.expectedOutput} Resultat: ${(result.output || '').slice(0, 1200)}
JSON: {"success":true,"confidence":85,"summary":"Resume","issues":[],"needsRetry":false,"retryHint":"","outputQuality":"good"}`, { maxTokens: 400 });
    const raw = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json\n?|```\n?/g, '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { mission.tokensUsed += 200; return JSON.parse(m[0]); }
  } catch {}
  return { success: !result.error, confidence: result.success ? 75 : 30, summary: result.output?.slice(0, 150) || 'OK', issues: [], needsRetry: false, outputQuality: 'acceptable' };
}

async function runMission(mission, notifyFn) {
  const notify = (type, data = {}) => {
    mission.logger.log(type, data);
    mission.emit(type, data);
    if (notifyFn) notifyFn(type, { ...mission.getStatus(), ...data });
  };

  try {
    for (let i = 0; i < mission.steps.length; i++) {
      if (mission.killSwitch) break;
      await mission.waitIfPaused();
      if (mission.killSwitch) break;

      const step = mission.steps[i];
      mission.currentStep = i + 1;
      notify('STEP_START', { step: i + 1, total: mission.steps.length, title: step.title, type: step.type, icon: STEP_TYPES[step.type] || '⚡' });

      let retries = 0, stepSuccess = false, stepResult = null, verification = null;
      while (retries <= LIMITS.MAX_RETRIES_PER_STEP && !stepSuccess) {
        if (mission.killSwitch) break;
        try {
          stepResult = await executeStep(mission, step, mission.results);
          verification = await verifyStep(mission, step, stepResult);
          if (verification.success && verification.confidence >= LIMITS.MIN_CONFIDENCE_TO_PROCEED) { stepSuccess = true; }
          else if (verification.needsRetry && retries < LIMITS.MAX_RETRIES_PER_STEP) { retries++; notify('STEP_RETRY', { step: i + 1, attempt: retries + 1, reason: verification.retryHint || 'Qualite insuffisante' }); }
          else if (verification.confidence >= 45) { stepSuccess = true; }
          else { throw new Error(`Verification echouee (${verification.confidence}%): ${verification.issues?.join(', ')}`); }
        } catch (e) {
          retries++;
          if (retries > LIMITS.MAX_RETRIES_PER_STEP) { notify('STEP_FAILED', { step: i + 1, title: step.title, error: e.message }); mission.state = STATES.FAILED; return; }
          notify('STEP_RETRY', { step: i + 1, attempt: retries + 1, reason: e.message });
          await new Promise(r => setTimeout(r, 2000 * retries));
        }
      }
      if (!stepSuccess || mission.killSwitch) break;

      mission.results.push({ stepId: i + 1, title: step.title, type: step.type, output: stepResult?.output?.slice(0, 800) || '', summary: verification?.summary || '', confidence: verification?.confidence || 0, quality: verification?.outputQuality || 'unknown', retries });
      notify('STEP_COMPLETE', { step: i + 1, total: mission.steps.length, title: step.title, summary: verification.summary, confidence: verification.confidence, tokensUsed: mission.tokensUsed, progress: Math.round(((i + 1) / mission.steps.length) * 100) });

      if ((i + 1) % LIMITS.CHECKPOINT_EVERY_N_STEPS === 0 && i + 1 < mission.steps.length) {
        notify('CHECKPOINT', { step: i + 1, total: mission.steps.length, progress: Math.round(((i + 1) / mission.steps.length) * 100), tokensUsed: mission.tokensUsed });
      }
    }

    if (!mission.killSwitch) {
      mission.state = STATES.COMPLETED;
      mission.completedAt = Date.now();
      if (mission._timeout) clearTimeout(mission._timeout);
      let report = 'Mission terminee';
      try {
        const bridge = require('./claude-api-bridge');
        const s = await bridge.callFast(`Resume en 2-3 phrases: Objectif "${mission.objective}" Resultats: ${mission.results.map(r => r.summary).join(' | ')}`, { maxTokens: 300 });
        report = typeof s === 'string' ? s : s.content?.[0]?.text || report;
      } catch {}
      notify('COMPLETED', { report, totalSteps: mission.results.length, tokensUsed: mission.tokensUsed, elapsed: Math.round((mission.completedAt - mission.startedAt) / 1000), results: mission.results });
    }
  } catch (e) {
    mission.state = STATES.FAILED;
    mission.logger.log('FATAL_ERROR', { error: e.message });
    notify('FATAL_ERROR', { error: e.message });
  }
}

const missions = new Map();

async function createMission(objective) {
  if (!objective?.trim()) throw new Error('Objectif requis');
  const running = Array.from(missions.values()).filter(m => m.state === STATES.RUNNING).length;
  if (running >= LIMITS.MAX_CONCURRENT_MISSIONS) throw new Error(`Limite de ${LIMITS.MAX_CONCURRENT_MISSIONS} missions simultanées`);
  const plan = await planMission(objective);
  const mission = new Mission(objective, plan);
  missions.set(mission.id, mission);
  return { missionId: mission.id, title: plan.title, complexity: plan.complexity, estimatedTokens: plan.estimatedTokens, tokenBudget: LIMITS.MAX_TOKENS_PER_MISSION, steps: plan.steps, risks: plan.risks, questions: plan.questions, state: STATES.AWAITING_APPROVAL };
}

function approveMission(missionId, notifyFn) {
  const mission = missions.get(missionId);
  if (!mission) throw new Error('Mission non trouvee');
  mission.start();
  setImmediate(() => {
    runMission(mission, notifyFn).catch(e => {
      mission.state = STATES.FAILED;
      mission.logger.log('UNCAUGHT_ERROR', { error: e.message });
      if (notifyFn) notifyFn('ERROR', { error: e.message });
    });
  });
  return mission.getStatus();
}

function killMission(missionId, reason) { const m = missions.get(missionId); if (!m) throw new Error('Non trouvee'); m.kill(reason || 'Kill manuel'); return m.getStatus(); }
function pauseMission(missionId) { const m = missions.get(missionId); if (!m) throw new Error('Non trouvee'); m.pause(); return m.getStatus(); }
function resumeMission(missionId) { const m = missions.get(missionId); if (!m) throw new Error('Non trouvee'); m.resume(); return m.getStatus(); }
function confirmStep(missionId, approved) { const m = missions.get(missionId); if (!m) throw new Error('Non trouvee'); m.confirm(approved); return m.getStatus(); }
function getMissionStatus(missionId) { const m = missions.get(missionId); if (!m) throw new Error('Non trouvee'); return m.getStatus(); }
function listMissions(filter) { let list = Array.from(missions.values()); if (filter) list = list.filter(m => m.state === filter); return list.map(m => m.getStatus()).sort((a, b) => (b.elapsed || 0) - (a.elapsed || 0)).slice(0, 20); }
function getMissionLog(missionId) { const m = missions.get(missionId); if (!m) throw new Error('Non trouvee'); return m.logger.getAll(); }

setInterval(() => {
  const cutoff = Date.now() - 86400000;
  for (const [id, m] of missions.entries()) {
    if (m.startedAt && m.startedAt < cutoff && [STATES.COMPLETED, STATES.FAILED, STATES.KILLED].includes(m.state)) missions.delete(id);
  }
}, 3600000).unref();

module.exports = { createMission, approveMission, killMission, pauseMission, resumeMission, confirmStep, getMissionStatus, listMissions, getMissionLog, STATES, LIMITS, STEP_TYPES };
