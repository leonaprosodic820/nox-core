'use strict';
/**
 * PROMETHEUS Missions Autonomes v8.0
 * Plan → Décomposition → Exécution séquentielle → Retry → Rapport
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const MISSIONS_DIR = path.join(__dirname, 'missions');
fs.mkdirSync(MISSIONS_DIR, { recursive: true });

class MissionRunner extends EventEmitter {
  constructor() {
    super();
    this.active = null;
    this.history = [];
    this.loadHistory();
  }

  loadHistory() {
    try {
      const files = fs.readdirSync(MISSIONS_DIR).filter(f => f.endsWith('.json')).sort().slice(-30);
      this.history = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(MISSIONS_DIR, f), 'utf8')); } catch (e) { return null; }
      }).filter(Boolean);
    } catch (e) {}
  }

  saveMission(mission) {
    const file = path.join(MISSIONS_DIR, `${mission.id}.json`);
    try { fs.writeFileSync(file, JSON.stringify(mission, null, 2)); } catch (e) {}
  }

  async plan(objective) {
    const bridge = require('./claude-api-bridge');
    const prompt = `Décompose cette mission en étapes exécutables. JSON strict:
{"steps":[{"id":1,"action":"description","type":"shell|web|mac|analysis|file","command":"commande si shell","retryable":true}],"estimated_minutes":5}

Types: shell (commande terminal), web (recherche internet), mac (contrôle macOS), analysis (réflexion Claude), file (lire/écrire fichier)
Mission: ${objective}`;

    try {
      const resp = await bridge.callFast(prompt, { maxTokens: 800 });
      const text = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const plan = JSON.parse(m[0]);
        return plan.steps || [];
      }
    } catch (e) {}

    // Fallback: single step
    return [{ id: 1, action: objective, type: 'analysis', retryable: false }];
  }

  async executeStep(step, context = {}) {
    const start = Date.now();
    let result = { stepId: step.id, status: 'pending' };

    try {
      switch (step.type) {
        case 'shell': {
          const { execSync } = require('child_process');
          if (/rm\s+-rf\s+\/|mkfs|format/i.test(step.command || '')) {
            result = { stepId: step.id, status: 'blocked', reason: 'Commande dangereuse' };
            break;
          }
          const cmd = step.command || step.action;
          const output = execSync(cmd, { encoding: 'utf8', timeout: 30000, cwd: path.join(require('os').homedir(), 'claude-relay') }).trim();
          result = { stepId: step.id, status: 'success', output: output.slice(0, 2000), command: cmd };
          break;
        }
        case 'web': {
          const webIntel = require('./web-intelligence');
          const data = await webIntel.smartSearch(step.action);
          result = { stepId: step.id, status: 'success', data: data.data, intent: data.intent };
          break;
        }
        case 'mac': {
          const { execSync } = require('child_process');
          const asCmd = step.command || 'return "OK"';
          const out = execSync('osascript -ss -e \'' + asCmd.replace(/'/g, "'\\''") + '\'', { encoding: 'utf8', timeout: 10000 }).trim();
          result = { stepId: step.id, status: 'success', output: out };
          break;
        }
        case 'file': {
          const targetPath = step.path || step.command;
          if (targetPath && fs.existsSync(targetPath)) {
            const content = fs.readFileSync(targetPath, 'utf8').slice(0, 5000);
            result = { stepId: step.id, status: 'success', content, path: targetPath };
          } else {
            result = { stepId: step.id, status: 'error', error: 'File not found: ' + targetPath };
          }
          break;
        }
        case 'analysis':
        default: {
          const bridge = require('./claude-api-bridge');
          const ctxStr = context.previousResults
            ? '\nRésultats précédents:\n' + context.previousResults.map(r => `Step ${r.stepId}: ${JSON.stringify(r).slice(0, 200)}`).join('\n')
            : '';
          const resp = await bridge.callFast(step.action + ctxStr, { maxTokens: 800 });
          const text = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
          result = { stepId: step.id, status: 'success', analysis: text.slice(0, 1500) };
          break;
        }
      }
    } catch (e) {
      result = { stepId: step.id, status: 'error', error: e.message };
    }

    result.durationMs = Date.now() - start;
    result.type = step.type;
    return result;
  }

  async run(objective, opts = {}) {
    if (this.active) return { error: 'Mission déjà en cours: ' + this.active.id };

    const id = 'mission_' + Date.now().toString(36);
    const mission = {
      id, objective, status: 'planning',
      startTs: new Date().toISOString(),
      steps: [], results: [], report: '',
      retries: 0, maxRetries: opts.maxRetries || 2,
    };
    this.active = mission;
    this.emit('start', { id, objective });

    // Phase 1: Plan
    mission.status = 'planning';
    this.emit('phase', { id, phase: 'planning' });
    mission.steps = await this.plan(objective);
    this.emit('planned', { id, steps: mission.steps.length });

    // Phase 2: Exécution séquentielle
    mission.status = 'executing';
    const previousResults = [];

    for (const step of mission.steps) {
      this.emit('step_start', { id, step });
      let result = await this.executeStep(step, { previousResults });

      // Retry si échec et retryable
      if (result.status === 'error' && step.retryable && mission.retries < mission.maxRetries) {
        mission.retries++;
        this.emit('retry', { id, stepId: step.id, attempt: mission.retries });
        await new Promise(r => setTimeout(r, 2000));
        result = await this.executeStep(step, { previousResults });
      }

      mission.results.push(result);
      previousResults.push(result);
      this.emit('step_done', { id, result });

      // Arrêter si step critique échoue
      if (result.status === 'error' && step.critical) {
        mission.status = 'failed';
        mission.failReason = `Step ${step.id} critique échoué: ${result.error}`;
        break;
      }
    }

    // Phase 3: Rapport
    if (mission.status !== 'failed') mission.status = 'reporting';
    this.emit('phase', { id, phase: 'reporting' });

    try {
      const bridge = require('./claude-api-bridge');
      const ctx = mission.results.map(r =>
        `Étape ${r.stepId} (${r.type}): ${r.status} — ${JSON.stringify(r).slice(0, 200)}`
      ).join('\n');

      const resp = await bridge.callFast(
        `Génère un rapport de mission concis.\nObjectif: ${objective}\nÉtapes:\n${ctx}\n\nRapport (markdown):`,
        { maxTokens: 600 }
      );
      mission.report = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
    } catch (e) {
      mission.report = `## Rapport Mission ${id}\n**Objectif**: ${objective}\n**Statut**: ${mission.status}\n**Étapes**: ${mission.results.length}/${mission.steps.length} complétées\n`;
      mission.results.forEach(r => {
        mission.report += `- Step ${r.stepId} (${r.type}): ${r.status}\n`;
      });
    }

    // Finaliser
    if (mission.status !== 'failed') mission.status = 'completed';
    mission.endTs = new Date().toISOString();
    mission.durationMs = Date.now() - new Date(mission.startTs).getTime();

    this.saveMission(mission);
    this.history.push(mission);
    if (this.history.length > 30) this.history.shift();
    this.active = null;
    this.emit('done', mission);

    return mission;
  }

  getActive() { return this.active; }
  getHistory() { return this.history.slice(-20).reverse(); }
  getMission(id) { return this.history.find(m => m.id === id) || null; }
  cancel() {
    if (this.active) { this.active.status = 'cancelled'; this.active = null; }
    return { cancelled: true };
  }
}

module.exports = new MissionRunner();
