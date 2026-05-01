const { app, server, wss, getInstances } = require('../server');
const request = require('supertest');
const superBrain = require('../super-brain');
const responseReader = require('../response-reader');
const decisionEngine = require('../decision-engine');
const autoValidator = require('../auto-validator');
const projectMemory = require('../project-memory');
const fs = require('fs');
const path = require('path');

const sessionsDir = path.join(__dirname, '..', 'sessions');
const decisionsDir = path.join(__dirname, '..', 'decisions');
const projectsDir = path.join(__dirname, '..', 'projects');

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => fs.unlinkSync(path.join(dir, f)));
}

let broadcasts = [];
decisionEngine.setBroadcast(d => broadcasts.push(d));
autoValidator.setBroadcast(d => broadcasts.push(d));

beforeEach(() => {
  cleanDir(sessionsDir);
  cleanDir(decisionsDir);
  cleanDir(projectsDir);
  getInstances().clear();
  broadcasts = [];
});

afterAll(() => {
  cleanDir(sessionsDir);
  cleanDir(decisionsDir);
  cleanDir(projectsDir);
  getInstances().clear();
});

async function createSession(name) {
  const res = await request(app).post('/sessions/new').send({ name });
  return res.body;
}

async function registerInstance(projectName, cliNumber, sessionId) {
  const res = await request(app).post('/instances/register').send({ projectName, cliNumber, sessionId });
  return res.body;
}

// T191: Scenario OPTIONS
test('T191: OPTIONS scenario — Brain auto-chooses without human', async () => {
  const { id } = await createSession('e2e-options');
  const inst = await registerInstance('e2e', 1, id);

  const text = 'Option A: Use Express\nOption B: Use Fastify (recommandé)\nOption C: Use Koa';
  const result = await decisionEngine.processAutonomously({
    sessionId: id, instanceId: inst.instanceId, projectName: 'e2e',
    rawInput: text,
    analysisResult: { type: 'options', elements: { prompt: null, options: [
      { label: 'A', description: 'Use Express', recommended: false },
      { label: 'B', description: 'Use Fastify', recommended: true },
      { label: 'C', description: 'Use Koa', recommended: false }
    ], tests: null, questions: null, confirmation: null, error: null } }
  });

  expect(result.decision.decision).toBe('choose_option');
  expect(result.decision.payload.optionChosen).toBe('B');
  expect(result.result.action).toBe('option_chosen');
});

// T192: Scenario QUESTION
test('T192: QUESTION scenario — Brain auto-answers', async () => {
  const result = await decisionEngine.processAutonomously({
    sessionId: 'q1', rawInput: 'Voulez-vous utiliser TypeScript?',
    analysisResult: { type: 'question', elements: { prompt: null, options: null, tests: null,
      questions: [{ text: 'Voulez-vous utiliser TypeScript?', answerType: 'confirm' }],
      confirmation: null, error: null } }
  });

  expect(result.decision.decision).toBe('answer_question');
  expect(result.decision.payload.answer).toBeTruthy();
});

// T193: Scenario ERROR
test('T193: ERROR scenario — Brain auto-corrects', async () => {
  const result = await decisionEngine.processAutonomously({
    sessionId: 'e1', rawInput: 'Error: Cannot find module express',
    analysisResult: { type: 'error', elements: { prompt: null, options: null, tests: null,
      questions: null, confirmation: null,
      error: { message: 'Cannot find module express', suggestion: 'npm install express' } } }
  });

  expect(result.decision.decision).toBe('retry_with_fix');
  expect(result.decision.payload.correctedPrompt).toBeTruthy();
});

// T194: Scenario COMPLETE
test('T194: COMPLETE scenario — Brain marks session done', async () => {
  const result = await decisionEngine.processAutonomously({
    sessionId: 'c1', rawInput: '✅ Tout est complété avec succès',
    analysisResult: { type: 'confirmation', elements: { prompt: null, options: null, tests: null,
      questions: null, confirmation: { message: 'Tout complété', success: true }, error: null } }
  });

  expect(result.decision.decision).toBe('mark_complete');
  expect(result.result.action).toBe('completed');
});

// T195: Scenario MULTI — 3 instances simultanées
test('T195: MULTI scenario — 3 instances simultaneously', async () => {
  const results = await Promise.all([
    decisionEngine.processAutonomously({
      sessionId: 's1', instanceId: 'i1', rawInput: '[CC_START]\necho 1\n[CC_END]',
      analysisResult: { type: 'prompt', elements: { prompt: 'echo 1', options: null, tests: null, questions: null, confirmation: null, error: null } }
    }),
    decisionEngine.processAutonomously({
      sessionId: 's2', instanceId: 'i2', rawInput: 'Option A: fast\nOption B: slow',
      analysisResult: { type: 'options', elements: { prompt: null, options: [
        { label: 'A', description: 'fast', recommended: true },
        { label: 'B', description: 'slow', recommended: false }
      ], tests: null, questions: null, confirmation: null, error: null } }
    }),
    decisionEngine.processAutonomously({
      sessionId: 's3', instanceId: 'i3', rawInput: '✅ Done',
      analysisResult: { type: 'confirmation', elements: { prompt: null, options: null, tests: null, questions: null, confirmation: { message: 'Done', success: true }, error: null } }
    })
  ]);

  expect(results[0].decision.decision).toBe('execute_prompt');
  expect(results[1].decision.decision).toBe('choose_option');
  expect(results[2].decision.decision).toBe('mark_complete');
});

// T196: Scenario RETRY
test('T196: RETRY scenario — error then retry', async () => {
  const retryResult = await decisionEngine.autoRetry('inst-retry', 'test error', 2);
  expect(retryResult.escalated).toBe(true);
  expect(retryResult.attempts.length).toBe(2);
});

// T197: Scenario CRASH — sessions persisted
test('T197: CRASH scenario — sessions persist in files', async () => {
  const { id } = await createSession('crash-test');
  await request(app).post(`/sessions/${id}/ingest`).send({ text: '[CC_START]\necho crash\n[CC_END]' });

  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);

  const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, files[0]), 'utf-8'));
  expect(session.iterations.length).toBeGreaterThan(0);
});

// T198: Scenario MEMORY — cross-session project context
test('T198: MEMORY scenario — project memory across sessions', async () => {
  projectMemory.loadProject('mem-test');
  const p = projectMemory.updateTask('mem-test', 'Build API');
  projectMemory.addCompletedTask('mem-test', 'Setup project');
  projectMemory.recordDecision('mem-test', { decision: 'execute_prompt', reasoning: 'test', confidence: 90 });

  const loaded = projectMemory.loadProject('mem-test');
  expect(loaded.currentTask).toBe('Build API');
  expect(loaded.completedTasks).toContain('Setup project');
  expect(loaded.decisions.length).toBe(1);
});

// T199: Scenario VALIDATOR — auto-approve
test('T199: VALIDATOR scenario — auto-approve proceed', () => {
  const result = autoValidator.validateClaudeCodeRequest('Do you want to proceed?');
  expect(result.approved).toBe(true);

  const dangerous = autoValidator.validateClaudeCodeRequest('sudo rm -rf /');
  expect(dangerous.approved).toBe(false);
  expect(dangerous.escalated).toBe(true);
});

// T200: Scenario FULL AUTONOME — 10 iterations
test('T200: FULL AUTONOME — 10 consecutive iterations without human', async () => {
  const inputs = [
    { type: 'prompt', elements: { prompt: 'echo 1', options: null, tests: null, questions: null, confirmation: null, error: null } },
    { type: 'options', elements: { prompt: null, options: [{ label: 'A', description: 'opt', recommended: true }], tests: null, questions: null, confirmation: null, error: null } },
    { type: 'question', elements: { prompt: null, options: null, tests: null, questions: [{ text: 'Continue?', answerType: 'confirm' }], confirmation: null, error: null } },
    { type: 'prompt', elements: { prompt: 'echo 2', options: null, tests: null, questions: null, confirmation: null, error: null } },
    { type: 'error', elements: { prompt: null, options: null, tests: null, questions: null, confirmation: null, error: { message: 'fail', suggestion: 'fix' } } },
    { type: 'prompt', elements: { prompt: 'echo 3', options: null, tests: null, questions: null, confirmation: null, error: null } },
    { type: 'options', elements: { prompt: null, options: [{ label: 'X', description: 'choice', recommended: false }], tests: null, questions: null, confirmation: null, error: null } },
    { type: 'prompt', elements: { prompt: 'echo 4', options: null, tests: null, questions: null, confirmation: null, error: null } },
    { type: 'question', elements: { prompt: null, options: null, tests: null, questions: [{ text: 'Ready?', answerType: 'confirm' }], confirmation: null, error: null } },
    { type: 'confirmation', elements: { prompt: null, options: null, tests: null, questions: null, confirmation: { message: 'All done', success: true }, error: null } },
  ];

  const results = [];
  for (let i = 0; i < 10; i++) {
    const result = await decisionEngine.processAutonomously({
      sessionId: `full-${i}`, instanceId: `inst-${i}`,
      rawInput: `iteration ${i}`, analysisResult: inputs[i]
    });
    results.push(result);
    expect(result.decision).toBeTruthy();
    expect(result.decision.decision).toBeTruthy();
  }

  expect(results.length).toBe(10);
  expect(results[0].decision.decision).toBe('execute_prompt');
  expect(results[1].decision.decision).toBe('choose_option');
  expect(results[9].decision.decision).toBe('mark_complete');
});
