'use strict';
/**
 * PROMETHEUS Multi-Agents v8.0
 * Orchestrateur central + 4 agents spécialisés en parallèle
 */
const EventEmitter = require('events');

class MultiAgentOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.activeMissions = new Map();
    this.completedMissions = [];
    this.agents = {
      web: { name: 'Agent Web', status: 'idle', tasks: 0 },
      code: { name: 'Agent Code', status: 'idle', tasks: 0 },
      mac: { name: 'Agent Mac', status: 'idle', tasks: 0 },
      analysis: { name: 'Agent Analyse', status: 'idle', tasks: 0 },
    };
  }

  // Décomposer une tâche complexe en sous-tâches par agent
  async decompose(objective) {
    try {
      const bridge = require('./claude-api-bridge');
      const prompt = `Décompose cette tâche en sous-tâches pour 4 agents spécialisés. JSON strict:
{"tasks":[{"agent":"web|code|mac|analysis","action":"description courte","priority":1-3}]}

Agents: web (recherche internet, données temps réel), code (exécution shell, scripts), mac (contrôle macOS, fichiers, apps), analysis (réflexion, synthèse, décision)

Tâche: ${objective}`;

      const resp = await bridge.callFast(prompt, { maxTokens: 500 });
      const text = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]).tasks || [];
    } catch (e) {}

    // Fallback: détection par mots-clés
    const tasks = [];
    if (/météo|news|crypto|prix|bourse|sport|cherch|search|web/i.test(objective))
      tasks.push({ agent: 'web', action: 'Recherche web: ' + objective, priority: 1 });
    if (/fichier|dossier|script|code|npm|git|install|build/i.test(objective))
      tasks.push({ agent: 'code', action: 'Exécution: ' + objective, priority: 1 });
    if (/screenshot|app|ouvr|ferme|volume|wifi|bluetooth|système/i.test(objective))
      tasks.push({ agent: 'mac', action: 'Contrôle Mac: ' + objective, priority: 1 });
    tasks.push({ agent: 'analysis', action: 'Analyse et synthèse: ' + objective, priority: 2 });
    return tasks;
  }

  // Exécuter un agent spécifique
  async executeAgent(agentType, task) {
    this.agents[agentType].status = 'working';
    this.agents[agentType].tasks++;
    const start = Date.now();

    try {
      switch (agentType) {
        case 'web': return await this._agentWeb(task);
        case 'code': return await this._agentCode(task);
        case 'mac': return await this._agentMac(task);
        case 'analysis': return await this._agentAnalysis(task);
        default: return { error: 'Unknown agent: ' + agentType };
      }
    } catch (e) {
      return { error: e.message, agent: agentType };
    } finally {
      this.agents[agentType].status = 'idle';
      this.agents[agentType].lastMs = Date.now() - start;
    }
  }

  async _agentWeb(task) {
    const webIntel = require('./web-intelligence');
    const intent = webIntel.detectIntent(task.action);
    const result = await webIntel.smartSearch(task.action, { intent });
    return { agent: 'web', intent, data: result.data, source: result.data?.source };
  }

  async _agentCode(task) {
    const { execSync } = require('child_process');
    // Extraire la commande à exécuter
    const cmdMatch = task.action.match(/`([^`]+)`/) || task.action.match(/:\s*(.+)/);
    const cmd = cmdMatch ? cmdMatch[1].trim() : task.action;
    // Sécurité: bloquer les commandes dangereuses
    if (/rm\s+-rf\s+\/|mkfs|dd\s+if|format\s+c/i.test(cmd)) {
      return { agent: 'code', blocked: true, reason: 'Commande dangereuse bloquée' };
    }
    try {
      const output = execSync(cmd, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      return { agent: 'code', command: cmd, output: output.slice(0, 2000), exitCode: 0 };
    } catch (e) {
      return { agent: 'code', command: cmd, error: e.stderr?.slice(0, 500) || e.message, exitCode: e.status };
    }
  }

  async _agentMac(task) {
    try {
      const mac = require('./mac-commander');
      // Détection de l'action Mac
      const action = task.action.toLowerCase();
      if (/screenshot|capture|écran/.test(action)) {
        const r = await mac.takeScreenshot({ silent: true });
        return { agent: 'mac', action: 'screenshot', result: r };
      }
      if (/volume/.test(action)) {
        const vol = await mac.system?.getVolume?.() || 'N/A';
        return { agent: 'mac', action: 'volume', volume: vol };
      }
      if (/clipboard|presse/.test(action)) {
        const clip = require('child_process').execSync('pbpaste', { encoding: 'utf8' }).slice(0, 500);
        return { agent: 'mac', action: 'clipboard', content: clip };
      }
      // Fallback: exécuter via AppleScript
      const { execSync } = require('child_process');
      const out = execSync(`osascript -ss -e 'tell application "System Events" to return name of every process whose background only is false'`, { encoding: 'utf8' }).trim();
      return { agent: 'mac', action: 'apps', apps: out };
    } catch (e) { return { agent: 'mac', error: e.message }; }
  }

  async _agentAnalysis(task) {
    const bridge = require('./claude-api-bridge');
    const resp = await bridge.callFast(task.action, { maxTokens: 800 });
    const text = typeof resp === 'string' ? resp : resp.content?.[0]?.text || JSON.stringify(resp);
    return { agent: 'analysis', analysis: text.slice(0, 1500) };
  }

  // Orchestrer une mission complète
  async executeMission(objective) {
    const missionId = 'M' + Date.now().toString(36);
    const mission = {
      id: missionId, objective, status: 'planning',
      startTs: new Date().toISOString(), tasks: [], results: [], synthesis: '',
    };
    this.activeMissions.set(missionId, mission);
    this.emit('mission_start', { id: missionId, objective });

    // Phase 1: Décomposition
    mission.status = 'decomposing';
    const tasks = await this.decompose(objective);
    mission.tasks = tasks;
    this.emit('mission_tasks', { id: missionId, tasks });

    // Phase 2: Exécution parallèle par priorité
    mission.status = 'executing';
    const priorities = [...new Set(tasks.map(t => t.priority))].sort();

    for (const prio of priorities) {
      const prioTasks = tasks.filter(t => t.priority === prio);
      const results = await Promise.allSettled(
        prioTasks.map(t => this.executeAgent(t.agent, t))
      );
      results.forEach((r, i) => {
        mission.results.push({
          task: prioTasks[i],
          result: r.status === 'fulfilled' ? r.value : { error: r.reason?.message },
          status: r.status,
        });
      });
      this.emit('mission_progress', { id: missionId, priority: prio, completed: results.length });
    }

    // Phase 3: Synthèse
    mission.status = 'synthesizing';
    try {
      const bridge = require('./claude-api-bridge');
      const ctx = mission.results.map(r =>
        `[${r.task.agent}] ${r.task.action}: ${JSON.stringify(r.result).slice(0, 300)}`
      ).join('\n');

      const resp = await bridge.callFast(
        `Synthétise les résultats de cette mission multi-agents.\nObjectif: ${objective}\n\nRésultats:\n${ctx}\n\nSynthèse concise:`,
        { maxTokens: 600 }
      );
      mission.synthesis = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
    } catch (e) {
      mission.synthesis = 'Synthèse auto: ' + mission.results.map(r =>
        `${r.task.agent}: ${r.status === 'fulfilled' ? 'OK' : 'FAIL'}`
      ).join(', ');
    }

    // Finaliser
    mission.status = 'completed';
    mission.endTs = new Date().toISOString();
    mission.durationMs = Date.now() - new Date(mission.startTs).getTime();
    this.activeMissions.delete(missionId);
    this.completedMissions.push(mission);
    if (this.completedMissions.length > 50) this.completedMissions.shift();
    this.emit('mission_done', mission);

    return mission;
  }

  getAgentStatus() { return this.agents; }
  getActiveMissions() { return [...this.activeMissions.values()]; }
  getCompletedMissions() { return this.completedMissions.slice(-20); }
}

module.exports = new MultiAgentOrchestrator();
