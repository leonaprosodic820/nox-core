const path = require('path');
const fs = require('fs');

const DECISIONS_DIR = path.join(__dirname, '..', 'decisions');

const brain = require('../brain');

beforeEach(() => {
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  const files = fs.readdirSync(DECISIONS_DIR);
  for (const f of files) {
    if (f.endsWith('.json')) {
      fs.unlinkSync(path.join(DECISIONS_DIR, f));
    }
  }
});

// T111
test('T111: think() returns object with all required fields', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'hello', analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result).toHaveProperty('decision');
  expect(result).toHaveProperty('reasoning');
  expect(result).toHaveProperty('payload');
  expect(result).toHaveProperty('confidence');
  expect(result).toHaveProperty('nextAction');
  expect(result).toHaveProperty('projectInsight');
});

// T112
test('T112: decision choose_option when type=options', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'pick one',
    analysisResult: { type: 'options', elements: { options: [{ label: 'A', description: 'test', recommended: true }] } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBe('choose_option');
});

// T113
test('T113: decision answer_question when type=question', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'question',
    analysisResult: { type: 'question', elements: { questions: [{ text: 'question?', answerType: 'confirm' }] } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBe('answer_question');
});

// T114
test('T114: decision execute_prompt when type=prompt', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'echo hello',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hello' } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBe('execute_prompt');
});

// T115
test('T115: decision retry_with_fix when type=error', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'error output',
    analysisResult: { type: 'error', elements: { error: { message: 'fail', suggestion: 'fix it' } } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBe('retry_with_fix');
});

// T116
test('T116: decision mark_complete when type=confirmation', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'done',
    analysisResult: { type: 'confirmation', elements: { confirmation: { message: 'done', success: true } } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBe('mark_complete');
});

// T117
test('T117: confidence always between 0 and 100', async () => {
  const types = ['prompt', 'options', 'question', 'error', 'confirmation', 'tests', 'unknown'];
  for (const type of types) {
    const ctx = {
      sessionId: 's1', instanceId: 'i1', projectName: 'test',
      rawInput: 'test',
      analysisResult: { type, elements: { prompt: 'x', options: [{ label: 'A' }], questions: [{ text: 'q?' }], error: { message: 'e' }, confirmation: { message: 'ok' } } },
      projectMemory: {}, sessionHistory: [], pendingDecision: null
    };
    const result = await brain.think(ctx);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  }
});

// T118
test('T118: reasoning always non-empty string', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'test',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(typeof result.reasoning).toBe('string');
  expect(result.reasoning.length).toBeGreaterThan(0);
});

// T119
test('T119: nextAction always present and non-empty', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'test',
    analysisResult: { type: 'question', elements: { questions: [{ text: 'ok?' }] } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(typeof result.nextAction).toBe('string');
  expect(result.nextAction.length).toBeGreaterThan(0);
});

// T120
test('T120: analyzeError returns object with correctedPrompt non-empty', async () => {
  const result = await brain.analyzeError('some error occurred', {});
  expect(result).toHaveProperty('correctedPrompt');
  expect(typeof result.correctedPrompt).toBe('string');
  expect(result.correctedPrompt.length).toBeGreaterThan(0);
});

// T121
test('T121: generateAnswer with questions returns object with answer', async () => {
  const questions = [{ text: 'Is it working?', answerType: 'confirm' }];
  const result = await brain.generateAnswer(questions, { objective: 'testing' });
  expect(result).toHaveProperty('answer');
  expect(typeof result.answer).toBe('string');
});

// T122
test('T122: evaluateCompletion with empty iterations returns complete=false', async () => {
  const result = await brain.evaluateCompletion([], 'build app');
  expect(result.complete).toBe(false);
});

// T123
test('T123: evaluateCompletion with confirmation iteration returns complete=true', async () => {
  const iterations = [{ analysisType: 'confirmation', result: 'ok' }];
  const result = await brain.evaluateCompletion(iterations, 'build app');
  expect(result.complete).toBe(true);
});

// T124
test('T124: think handles missing analysisResult gracefully', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'hello', projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBeDefined();
});

// T125
test('T125: think handles null rawInput gracefully', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: null, analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result).toBeDefined();
  expect(result.decision).toBeDefined();
});

// T126
test('T126: logDecision creates file in decisions/ dir', () => {
  const ctx = { sessionId: 's1', instanceId: 'i1', projectName: 'test' };
  const decision = { decision: 'wait', reasoning: 'test', confidence: 50, nextAction: 'wait' };
  brain.logDecision(ctx, decision);
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(DECISIONS_DIR, `${date}.json`);
  expect(fs.existsSync(file)).toBe(true);
  const entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
  expect(entries.length).toBeGreaterThan(0);
});

// T127
test('T127: projectInsight non-empty in response', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'hello',
    analysisResult: { type: 'options', elements: { options: [{ label: 'B', description: 'opt' }] } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(typeof result.projectInsight).toBe('string');
  expect(result.projectInsight.length).toBeGreaterThan(0);
});

// T128
test('T128: think uses sessionHistory without crash', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'test',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: {},
    sessionHistory: [
      { iteration: 1, analysisType: 'prompt', result: 'ok' },
      { iteration: 2, analysisType: 'question', result: 'answered' }
    ],
    pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result).toBeDefined();
  expect(result.decision).toBe('execute_prompt');
});

// T129
test('T129: think uses projectMemory without crash', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'test',
    analysisResult: { type: 'prompt', elements: { prompt: 'echo hi' } },
    projectMemory: { objective: 'build a web app', files: ['index.js'], progress: 50 },
    sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result).toBeDefined();
  expect(result.decision).toBe('execute_prompt');
});

// T130
test('T130: payload contains optionChosen when decision is choose_option', async () => {
  const ctx = {
    sessionId: 's1', instanceId: 'i1', projectName: 'test',
    rawInput: 'pick',
    analysisResult: { type: 'options', elements: { options: [{ label: 'X', description: 'do X', recommended: true }] } },
    projectMemory: {}, sessionHistory: [], pendingDecision: null
  };
  const result = await brain.think(ctx);
  expect(result.decision).toBe('choose_option');
  expect(result.payload).toHaveProperty('optionChosen');
  expect(result.payload.optionChosen).toBe('X');
});
