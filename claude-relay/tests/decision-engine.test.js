const path = require('path');
const fs = require('fs');

const DECISIONS_DIR = path.join(__dirname, '..', 'decisions');

// Mock notifier to avoid system notifications during tests
jest.mock('../notifier', () => ({
  notify: jest.fn()
}));

const engine = require('../decision-engine');

beforeEach(() => {
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  const files = fs.readdirSync(DECISIONS_DIR);
  for (const f of files) {
    if (f.endsWith('.json')) {
      fs.unlinkSync(path.join(DECISIONS_DIR, f));
    }
  }
  // Reset broadcast to a fresh mock for each test
  engine.setBroadcast(jest.fn());
});

// T131
test('T131: processAutonomously returns {decision, result} for options input', async () => {
  const payload = {
    sessionId: 's1', instanceId: 'i1', rawInput: 'pick one',
    analysisResult: { type: 'options', elements: { options: [{ label: 'A', description: 'test', recommended: true }] } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  };
  const res = await engine.processAutonomously(payload);
  expect(res).toHaveProperty('decision');
  expect(res).toHaveProperty('result');
  expect(res.decision.decision).toBe('choose_option');
});

// T132
test('T132: processAutonomously returns answer for question input', async () => {
  const payload = {
    sessionId: 's1', instanceId: 'i1', rawInput: 'question',
    analysisResult: { type: 'question', elements: { questions: [{ text: 'ok?', answerType: 'confirm' }] } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  };
  const res = await engine.processAutonomously(payload);
  expect(res.decision.decision).toBe('answer_question');
  expect(res.result.action).toBe('answer_generated');
});

// T133
test('T133: processAutonomously returns retry for error input', async () => {
  const payload = {
    sessionId: 's1', instanceId: 'i1', rawInput: 'error output',
    analysisResult: { type: 'error', elements: { error: { message: 'fail', suggestion: 'fix' } } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  };
  const res = await engine.processAutonomously(payload);
  expect(res.decision.decision).toBe('retry_with_fix');
  expect(res.result.action).toBe('retry_scheduled');
});

// T134
test('T134: processAutonomously returns completed for confirmation input', async () => {
  const payload = {
    sessionId: 's1', instanceId: 'i1', rawInput: 'done',
    analysisResult: { type: 'confirmation', elements: { confirmation: { message: 'done', success: true } } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  };
  const res = await engine.processAutonomously(payload);
  expect(res.decision.decision).toBe('mark_complete');
  expect(res.result.action).toBe('completed');
});

// T135
test('T135: pollForResult with very short timeout returns timedOut true', async () => {
  const res = await engine.pollForResult('i1', 50);
  expect(res.timedOut).toBe(true);
}, 10000);

// T136
test('T136: pollForResult timedOut field exists', async () => {
  const res = await engine.pollForResult('i1', 50);
  expect(res).toHaveProperty('timedOut');
  expect(res.timedOut).toBe(true);
}, 10000);

// T137
test('T137: autoRetry calls 3 times then escalates', async () => {
  const mockBroadcast = jest.fn();
  engine.setBroadcast(mockBroadcast);
  const res = await engine.autoRetry('i1', 'test failure', 3);
  expect(res.escalated).toBe(true);
  expect(res.attempts).toHaveLength(3);
}, 10000);

// T138
test('T138: autoRetry broadcasts escalation event after maxRetries', async () => {
  const mockBroadcast = jest.fn();
  engine.setBroadcast(mockBroadcast);
  await engine.autoRetry('i1', 'test failure', 3);
  const escalationCall = mockBroadcast.mock.calls.find(c => c[0].event === 'escalation');
  expect(escalationCall).toBeDefined();
}, 10000);

// T139
test('T139: two processAutonomously calls in parallel do not crash', async () => {
  const payload1 = {
    sessionId: 's1', instanceId: 'i1', rawInput: 'hello',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  };
  const payload2 = {
    sessionId: 's2', instanceId: 'i2', rawInput: 'world',
    analysisResult: { type: 'options', elements: { options: [{ label: 'B' }] } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst2'
  };
  const [res1, res2] = await Promise.all([
    engine.processAutonomously(payload1),
    engine.processAutonomously(payload2)
  ]);
  expect(res1.decision).toBeDefined();
  expect(res2.decision).toBeDefined();
});

// T140
test('T140: getDecisions returns array', () => {
  const result = engine.getDecisions('2020-01-01');
  expect(Array.isArray(result)).toBe(true);
});

// T141
test('T141: logOutcome does not crash with valid params', () => {
  const decision = { decision: 'wait', reasoning: 'test', confidence: 50 };
  const result = { action: 'waiting' };
  expect(() => engine.logOutcome(decision, result)).not.toThrow();
});

// T142
test('T142: getStats returns object with required fields', () => {
  const stats = engine.getStats();
  expect(stats).toHaveProperty('totalDecisionsToday');
  expect(stats).toHaveProperty('byType');
  expect(stats).toHaveProperty('averageConfidence');
  expect(stats).toHaveProperty('uptime');
});

// T143
test('T143: autoRetry with maxRetries=1 escalates after 1 retry', async () => {
  const mockBroadcast = jest.fn();
  engine.setBroadcast(mockBroadcast);
  const res = await engine.autoRetry('i1', 'single fail', 1);
  expect(res.escalated).toBe(true);
  expect(res.attempts).toHaveLength(1);
}, 10000);

// T144
test('T144: processAutonomously does not crash with minimal payload', async () => {
  const payload = {
    sessionId: 'test', rawInput: 'hello',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } }
  };
  const res = await engine.processAutonomously(payload);
  expect(res).toBeDefined();
  expect(res.decision).toBeDefined();
});

// T145
test('T145: processAutonomously with no analysisResult does not crash', async () => {
  const payload = { sessionId: 'test', rawInput: 'hello' };
  const res = await engine.processAutonomously(payload);
  expect(res).toBeDefined();
  expect(res.decision).toBeDefined();
});

// T146
test('T146: broadcast receives brain_thinking event during processAutonomously', async () => {
  const mockBroadcast = jest.fn();
  engine.setBroadcast(mockBroadcast);
  await engine.processAutonomously({
    sessionId: 's1', instanceId: 'i1', rawInput: 'hello',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  });
  const thinkingCall = mockBroadcast.mock.calls.find(c => c[0].event === 'brain_thinking');
  expect(thinkingCall).toBeDefined();
});

// T147
test('T147: broadcast receives decision_made event after processAutonomously', async () => {
  const mockBroadcast = jest.fn();
  engine.setBroadcast(mockBroadcast);
  await engine.processAutonomously({
    sessionId: 's1', instanceId: 'i1', rawInput: 'hello',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {}, sessionHistory: [], projectName: 'test', instanceLabel: 'inst1'
  });
  const decisionCall = mockBroadcast.mock.calls.find(c => c[0].event === 'decision_made');
  expect(decisionCall).toBeDefined();
});

// T148
test('T148: executeDecision with choose_option returns action option_chosen', async () => {
  const decision = { decision: 'choose_option', payload: { optionChosen: 'A' }, reasoning: 'test' };
  const payload = { sessionId: 's1', instanceId: 'i1', instanceLabel: 'inst1' };
  const result = await engine.executeDecision(decision, payload);
  expect(result.action).toBe('option_chosen');
});

// T149
test('T149: executeDecision with escalate returns action escalated', async () => {
  const decision = { decision: 'escalate', payload: {}, reasoning: 'needs human' };
  const payload = { sessionId: 's1', instanceId: 'i1', instanceLabel: 'inst1' };
  const result = await engine.executeDecision(decision, payload);
  expect(result.action).toBe('escalated');
});

// T150
test('T150: getStats().uptime is number > 0', () => {
  const stats = engine.getStats();
  expect(typeof stats.uptime).toBe('number');
  expect(stats.uptime).toBeGreaterThan(0);
});
