jest.mock('../claude-api-bridge', () => ({
  call: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({
      decision: { action: 'send_to_claude_code', reasoning: 'test mock decision', confidence: 95 },
      enhanced_payload: { promptForClaudeCode: '[CC_START]\necho test\n[CC_END]' },
      navigation: { currentPhase: 'implementation', progressPercent: 50, nextMilestone: 'test' },
      plan: { phases: [{ name: 'test', steps: [{ action: 'echo', target: 'mac_system', prompt: 'echo ok' }] }] },
      firstStep: { target: 'mac_system', prompt: 'echo PROMETHEUS_TEST', reasoning: 'test' },
      cause: 'test error', fix: 'restart', command: null, canAutoHeal: true
    }) }]
  }),
  callFast: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'OK' }] }),
  parseJSON: jest.requireActual('../claude-api-bridge').parseJSON,
  isAvailable: jest.fn().mockReturnValue(true),
  getStats: jest.fn().mockReturnValue({ calls: 5, cacheHits: 2, totalMs: 30000, cacheSize: 3, cacheHitRate: 0.4, avgMs: 10000 }),
  clearCache: jest.fn(),
  CLAUDE_PATH: '/usr/local/bin/claude'
}));

const prometheus = require('../prometheus');
const omegaBrain = require('../omega-brain');
const selfHealer = require('../self-healer');
const contextOmniscient = require('../context-omniscient');
const kb = require('../knowledge-base');
const fs = require('fs');
const path = require('path');

const decisionsDir = path.join(__dirname, '..', 'decisions');
const knowledgeDir = path.join(__dirname, '..', 'knowledge');

function cleanDir(dir) {
  try { fs.readdirSync(dir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl')).forEach(f => fs.unlinkSync(path.join(dir, f))); } catch {}
}

beforeEach(() => { cleanDir(decisionsDir); cleanDir(knowledgeDir); });
afterAll(() => { cleanDir(decisionsDir); cleanDir(knowledgeDir); });

describe('PROMETHEUS', () => {
  test('P01 — getState returns complete object', () => {
    const state = prometheus.getState();
    expect(state).toHaveProperty('state');
    expect(state).toHaveProperty('totalMissions');
    expect(state).toHaveProperty('totalDecisions');
    expect(state).toHaveProperty('intelligenceScore');
    expect(state).toHaveProperty('uptimeSeconds');
    expect(typeof state.uptimeSeconds).toBe('number');
  });

  test('P02 — totalDecisions starts at 0 or more', () => {
    expect(prometheus.getState().totalDecisions).toBeGreaterThanOrEqual(0);
  });

  test('P03 — intelligenceScore is 950', () => {
    expect(prometheus.getState().intelligenceScore).toBe(950);
  });

  test('P04 — executeObjective returns result', async () => {
    const result = await prometheus.executeObjective('Test simple', {
      projectMemory: { name: 'test', techStack: ['Node.js'] }, sessionHistory: []
    });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('missionId');
  }, 15000);

  test('P05 — totalMissions incremented', async () => {
    const before = prometheus.getState().totalMissions;
    await prometheus.executeObjective('Test increment', { projectMemory: { name: 'test' }, sessionHistory: [] });
    expect(prometheus.getState().totalMissions).toBeGreaterThan(before);
  }, 15000);

  test('P06 — emits mission_start event', (done) => {
    prometheus.once('mission_start', (data) => {
      expect(data).toHaveProperty('missionId');
      expect(data).toHaveProperty('objective');
      done();
    });
    prometheus.executeObjective('Test event', { projectMemory: { name: 'test' }, sessionHistory: [] }).catch(() => done());
  }, 15000);
});

describe('SELF HEALER', () => {
  test('P07 — runDiagnostic returns results', async () => {
    const result = await selfHealer.runDiagnostic();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  test('P08 — getCurrentState returns memory and uptime', async () => {
    const state = await selfHealer.getCurrentState();
    expect(state).toHaveProperty('memory');
    expect(state).toHaveProperty('uptime');
    expect(state.uptime).toBeGreaterThan(0);
  });

  test('P09 — heal known error returns KB solution', async () => {
    kb.addErrorSolution('test error prom known', 'restart service');
    const result = await selfHealer.heal({ message: 'test error prom known' }, {});
    expect(result.healed).toBe(true);
    expect(result.fromKnowledgeBase).toBe(true);
  });

  test('P10 — heal unknown error calls bridge', async () => {
    const bridge = require('../claude-api-bridge');
    bridge.call.mockClear();
    await selfHealer.heal({ message: 'completely unknown xyz 99999' }, {});
    expect(bridge.call).toHaveBeenCalled();
  }, 15000);
});

describe('CONTEXT OMNISCIENT', () => {
  test('P11 — gatherAll returns non-empty object', async () => {
    const ctx = await contextOmniscient.gatherAll({ objective: 'test' });
    expect(ctx).toBeDefined();
    expect(ctx).toHaveProperty('timestamp');
    expect(ctx).toHaveProperty('environment');
  });

  test('P12 — environment contains nodeVersion', async () => {
    const ctx = await contextOmniscient.gatherAll({});
    expect(ctx.environment.nodeVersion).toBe(process.version);
  });

  test('P13 — relay contains sessions count', async () => {
    const ctx = await contextOmniscient.gatherAll({});
    expect(ctx.relay).toBeDefined();
    expect(typeof ctx.relay.sessions).toBe('number');
  });
});

describe('OMEGA BRAIN', () => {
  test('O01 — think returns decision object', async () => {
    const result = await omegaBrain.think('[CC_START]\necho hello\n[CC_END]', {
      sessionId: 'test-omega', instanceLabel: 'TEST',
      projectMemory: { name: 'test' }, sessionHistory: [], iterationNumber: 1
    });
    expect(result).toHaveProperty('decision');
    expect(result.decision).toHaveProperty('action');
    expect(result.decision).toHaveProperty('confidence');
  }, 15000);

  test('O02 — confidence is 0-100', async () => {
    const result = await omegaBrain.think('test', { sessionId: 'test', instanceLabel: 'T', projectMemory: {}, sessionHistory: [], iterationNumber: 1 });
    expect(result.decision.confidence).toBeGreaterThanOrEqual(0);
    expect(result.decision.confidence).toBeLessThanOrEqual(100);
  }, 15000);

  test('O03 — action is valid', async () => {
    const valid = ['send_to_claude_code', 'choose_option', 'answer_question', 'retry_with_fix', 'mark_complete', 'escalate', 'wait', 'acknowledge_info', 'run_tests', 'decide_autonomously'];
    const result = await omegaBrain.think('test', { sessionId: 'test', instanceLabel: 'T', projectMemory: {}, sessionHistory: [], iterationNumber: 1 });
    expect(valid).toContain(result.decision.action);
  }, 15000);

  test('O04 — decision logged in decisions/', async () => {
    await omegaBrain.think('test log', { sessionId: 'test-log', instanceLabel: 'LOG', projectMemory: {}, sessionHistory: [], iterationNumber: 1 });
    const date = new Date().toISOString().slice(0, 10);
    const logPath = path.join(decisionsDir, `${date}.jsonl`);
    expect(fs.existsSync(logPath)).toBe(true);
  }, 15000);

  test('O05 — getStatus returns availability info', () => {
    const status = omegaBrain.getStatus();
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('mode');
    expect(status).toHaveProperty('model');
  });
});
