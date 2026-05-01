'use strict';

const VPSAgent = {
  name: 'VPSAgent', running: false, lastRun: null, lastStatus: {},
  async run() {
    if (this.running) return this.lastStatus;
    this.running = true; this.lastRun = new Date().toISOString();
    try {
      const { execSync } = require('child_process');
      const results = {};
      for (const vps of ['vps1', 'vps2']) {
        try {
          const out = execSync('ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ' + vps + ' "echo ok && df -h / | tail -1"', { encoding: 'utf8', timeout: 10000 }).trim().split('\n');
          const diskPct = parseInt((out[1] || '').match(/(\d+)%/)?.[1] || '0');
          results[vps] = { online: true, disk: diskPct + '%', warning: diskPct > 80 };
        } catch(e) { results[vps] = { online: false, error: e.message.slice(0, 50) }; }
      }
      this.lastStatus = results;
      return results;
    } finally { this.running = false; }
  },
  getStatus() { return { lastRun: this.lastRun, status: this.lastStatus }; },
};

const AgentOrchestrator = {
  agents: { VPSAgent },
  schedules: new Map(),
  start(onResult) {
    console.log('[Agents] Démarrage orchestrateur');
    this.schedules.set('vps', setInterval(async () => {
      try {
        const r = await VPSAgent.run();
        const down = Object.entries(r).filter(([, v]) => !v.online).map(([k]) => k);
        if (down.length > 0 && onResult) onResult('vps_down', { servers: down });
      } catch(e) {}
    }, 300000));
    this.schedules.set('weekly', setInterval(async () => {
      const d = new Date();
      if (d.getDay() !== 0 || d.getHours() !== 9) return;
      try { const ltm = require('./long-term-memory'); const digest = await ltm.generateWeeklySummary(); if (digest && onResult) onResult('weekly_digest', digest); } catch(e) {}
    }, 3600000));
  },
  stop() { this.schedules.forEach(s => clearInterval(s)); this.schedules.clear(); },
  async runAgent(name) { const agent = this.agents[name]; if (!agent) return { error: 'Agent non trouvé' }; return agent.run(); },
  getStatus() { return Object.entries(this.agents).map(([name, agent]) => ({ name, running: agent.running, lastRun: agent.lastRun })); },
};

module.exports = { VPSAgent, AgentOrchestrator };
