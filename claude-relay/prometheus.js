const EventEmitter = require('events');
const bridge = require('./claude-api-bridge');
const { compress } = require('./context-compressor');
const kb = require('./knowledge-base');
const perfTracker = require('./performance-tracker');

let selfHealer, contextOmniscient;
try { selfHealer = require('./self-healer'); } catch { selfHealer = null; }
try { contextOmniscient = require('./context-omniscient'); } catch { contextOmniscient = null; }

const PROMETHEUS_SYSTEM = `You are PROMETHEUS — an autonomous AI project orchestrator.
Given a high-level objective, you create a complete execution plan and decide each step.

You can target:
- claude_code: send a prompt to Claude Code CLI for file/code operations
- mac_system: execute a shell command on macOS
- decision: make an autonomous decision without external tools

Return ONLY JSON:
{
  "plan": {
    "title": "mission title",
    "phases": [{
      "name": "phase name",
      "steps": [{
        "action": "description",
        "target": "claude_code|mac_system|decision",
        "command": "the prompt or command to execute",
        "successCriteria": "how to verify success"
      }]
    }],
    "estimatedSteps": number,
    "risks": ["risk 1"]
  },
  "firstStep": {
    "target": "claude_code|mac_system|decision",
    "command": "exact command for first step",
    "reasoning": "why this first"
  }
}`;

class Prometheus extends EventEmitter {
  constructor() {
    super();
    this.consciousness = {
      state: 'initializing',
      totalMissions: 0,
      totalDecisions: 0,
      totalHealed: 0,
      uptime: Date.now(),
      intelligenceScore: 950
    };
    this.activeMissions = new Map();
    this.init();
  }

  async init() {
    if (selfHealer) {
      try { await selfHealer.runDiagnostic(); } catch {}
    }
    this.consciousness.state = 'operational';
    this.emit('prometheus_ready', this.getState());
  }

  async executeObjective(objective, context = {}) {
    const missionId = `m-${Date.now()}`;
    this.consciousness.totalMissions++;
    this.consciousness.totalDecisions++;

    this.emit('mission_start', { missionId, objective });

    let fullContext = context;
    if (contextOmniscient) {
      try { fullContext = await contextOmniscient.gatherAll({ ...context, objective }); } catch {}
    }

    try {
      const response = await bridge.call(
        `OBJECTIVE: ${objective}\n\nCONTEXT:\nProject: ${context.projectMemory?.name || 'N/A'}\nStack: ${(context.projectMemory?.techStack || []).join(', ')}\nKnowledge entries: ${Object.keys(kb.loadGlobal().errorSolutions || {}).length}\n\nCreate a plan and identify the first step.`,
        { systemPrompt: PROMETHEUS_SYSTEM, timeoutMs: 60000 }
      );

      const plan = bridge.parseJSON(response);
      this.activeMissions.set(missionId, { plan, status: 'executing', startTime: Date.now() });

      const result = await this.executeFirstStep(missionId, plan, fullContext);

      this.activeMissions.get(missionId).status = 'completed';
      this.emit('mission_complete', { missionId, result, plan });

      kb.addSuccessPattern(objective.slice(0, 50), { missionId });
      perfTracker.trackIteration(context.sessionId || 'prometheus', {
        qualityScore: 90, action: 'mark_complete', enhancements: 1
      });

      return { missionId, plan, result, success: true, duration: (Date.now() - this.activeMissions.get(missionId).startTime) / 1000 };

    } catch (e) {
      let healed = null;
      if (selfHealer) {
        try {
          healed = await selfHealer.heal(e, fullContext);
          this.consciousness.totalHealed++;
          this.emit('self_healed', { missionId, error: e.message, healed });
        } catch {}
      }

      this.emit('mission_error', { missionId, error: e.message, healed });
      kb.addFailurePattern(objective.slice(0, 50), e.message);

      return { missionId, success: false, error: e.message, healed };
    }
  }

  async executeFirstStep(missionId, plan, context) {
    const step = plan.firstStep;
    if (!step) return { executed: false, reason: 'No first step in plan' };

    this.emit('mission_step', { missionId, step });
    this.consciousness.totalDecisions++;

    try {
      switch (step.target) {
        case 'mac_system': {
          const macCmd = require('./mac-commander');
          return macCmd.system.runCommand(step.command);
        }
        case 'claude_code': {
          const nav = require('./omega-navigator');
          return await nav.navigate(`prometheus-${missionId}`, `[CC_START]\n${step.command}\n[CC_END]`, {
            sessionId: missionId, instanceLabel: 'PROMETHEUS', projectMemory: context.projectMemory || {}, sessionHistory: []
          });
        }
        case 'decision':
          return { decision: step.command, reasoning: step.reasoning };
        default:
          return { executed: false, reason: `Unknown target: ${step.target}` };
      }
    } catch (e) {
      return { executed: false, error: e.message };
    }
  }

  getMission(missionId) { return this.activeMissions.get(missionId); }

  getState() {
    return {
      ...this.consciousness,
      uptimeSeconds: Math.floor((Date.now() - this.consciousness.uptime) / 1000),
      activeMissions: this.activeMissions.size
    };
  }
}

module.exports = new Prometheus();
