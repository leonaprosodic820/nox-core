'use strict';
const EventEmitter = require('events');
const streamMgr = require('./sse-stream-manager');

class MissionRunner extends EventEmitter {
  constructor() {
    super();
    this.running = new Map();
  }
  async run(objective, sessionId, streamRes = null) {
    const multiAgent = require('./multi-agent');
    const missionId = 'run_' + Date.now();
    if (streamRes) {
      streamMgr.create(sessionId, streamRes);
      streamMgr.sendAction(sessionId, 'Planification...');
    }
    const plan = await multiAgent.createMission(objective);
    if (plan.error) throw new Error(plan.error);
    if (streamRes) {
      streamMgr.sendAction(sessionId, plan.steps.length + ' étapes planifiées');
    }
    this.running.set(missionId, { plan, sessionId, startedAt: Date.now() });
    const status = multiAgent.approveMission(plan.missionId, (type, data) => {
      if (!streamRes) return;
      if (type === 'STEP_START') streamMgr.sendAction(sessionId, 'Étape ' + data.step + '/' + data.total + ': ' + data.title);
      if (type === 'STEP_COMPLETE') streamMgr.sendToken(sessionId, '\n' + data.title + ': ' + data.summary + '\n');
      if (type === 'COMPLETED') {
        streamMgr.sendToken(sessionId, '\nMission terminée\n' + data.summary);
        streamMgr.end(sessionId, { missionId: plan.missionId });
      }
      if (type === 'FAILED' || type === 'KILLED') streamMgr.sendError(sessionId, data.reason || 'Mission échouée');
      this.emit(type, { missionId, ...data });
    });
    this.running.set(missionId, { ...this.running.get(missionId), status });
    return { missionId: plan.missionId, plan, status };
  }
  kill(missionId, reason) {
    const multiAgent = require('./multi-agent');
    return multiAgent.killMission(missionId, reason || 'Kill manuel');
  }
  getStats() {
    return {
      running: this.running.size,
      missions: [...this.running.values()].map(m => ({
        sessionId: m.sessionId,
        elapsed: Math.round((Date.now() - m.startedAt) / 1000),
        objective: m.plan?.objective?.slice(0, 50),
      })),
    };
  }
}
module.exports = new MissionRunner();
