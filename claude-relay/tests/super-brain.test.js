const fs = require('fs');
const path = require('path');
const { think, analyzeError, generateAnswer, evaluateCompletion, logDecision, isAvailable, ruleBasedDecision, makeDecision } = require('../super-brain');

const DECISIONS_DIR = path.join(__dirname, '..', 'decisions');

const REQUIRED_KEYS = ['decision', 'confidence', 'reasoning', 'payload', 'nextAction', 'projectInsight', 'extractedFacts', 'warningsDetected'];

function makeDR(overrides = {}) {
  return {
    rawText: '', language: 'en', sections: [], primaryIntent: 'provide_info',
    actionRequired: false, actionType: 'provide_info',
    extractedEntities: { files: [], commands: [], urls: [], ports: [], technologies: [], envVars: [], errorMessages: [], packageNames: [] },
    prompt: null, options: null, tests: null, questions: null,
    confirmation: null, error: null, complexity: 'simple',
    confidence: 50, warnings: [], suggestedNextStep: '',
    ...overrides
  };
}

describe('super-brain', () => {
  beforeEach(() => {
    // Clean decisions dir
    if (fs.existsSync(DECISIONS_DIR)) {
      const files = fs.readdirSync(DECISIONS_DIR);
      for (const f of files) {
        fs.unlinkSync(path.join(DECISIONS_DIR, f));
      }
    } else {
      fs.mkdirSync(DECISIONS_DIR, { recursive: true });
    }
  });

  // T1
  test('think() returns object with all required fields', async () => {
    const result = await think(makeDR());
    for (const key of REQUIRED_KEYS) {
      expect(result).toHaveProperty(key);
    }
  });

  // T2
  test('decision "execute_prompt" when deepRead has prompt', async () => {
    const result = await think(makeDR({ prompt: 'echo test', primaryIntent: 'execute_prompt', actionRequired: true }));
    expect(result.decision).toBe('execute_prompt');
  });

  // T3
  test('decision "choose_option" when deepRead has options', async () => {
    const result = await think(makeDR({
      options: [{ label: 'A', description: 'test', recommended: true }],
      primaryIntent: 'needs_choice', actionRequired: true
    }));
    expect(result.decision).toBe('choose_option');
  });

  // T4
  test('decision "answer_question" when deepRead has questions', async () => {
    const result = await think(makeDR({
      questions: [{ text: 'Q?', answerType: 'confirm' }],
      primaryIntent: 'needs_answer', actionRequired: true
    }));
    expect(result.decision).toBe('answer_question');
  });

  // T5
  test('decision "retry_with_fix" when deepRead has error', async () => {
    const result = await think(makeDR({
      error: { message: 'fail', type: 'runtime', suggestion: 'fix' },
      primaryIntent: 'needs_fix', actionRequired: true
    }));
    expect(result.decision).toBe('retry_with_fix');
  });

  // T6
  test('decision "mark_complete" when deepRead has confirmation', async () => {
    const result = await think(makeDR({
      confirmation: { message: 'done', success: true },
      primaryIntent: 'task_complete', actionRequired: false
    }));
    expect(result.decision).toBe('mark_complete');
  });

  // T7
  test('decision "acknowledge_info" when deepRead has actionRequired=false', async () => {
    const result = await think(makeDR({
      actionRequired: false,
      prompt: null, options: null, questions: null, error: null, confirmation: null, tests: null
    }));
    expect(result.decision).toBe('acknowledge_info');
  });

  // T8
  test('decision "run_tests" when deepRead has tests', async () => {
    const result = await think(makeDR({
      tests: [{ step: 1, action: 'test', expected: 'pass' }],
      primaryIntent: 'run_tests', actionRequired: true
    }));
    expect(result.decision).toBe('run_tests');
  });

  // T9
  test('decision "wait" when deepRead is mostly empty', async () => {
    const result = await think(makeDR({
      actionRequired: true,
      prompt: null, options: null, questions: null, tests: null, error: null, confirmation: null
    }));
    expect(result.decision).toBe('wait');
  });

  // T10
  test('confidence always 0-100', async () => {
    const scenarios = [
      makeDR({ prompt: 'x' }),
      makeDR({ options: [{ label: 'A', description: 'x', recommended: true }] }),
      makeDR({ error: { message: 'e', type: 'runtime', suggestion: 's' } }),
      makeDR(),
    ];
    for (const dr of scenarios) {
      const result = await think(dr);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    }
  });

  // T11
  test('reasoning always string with at least 2 words', async () => {
    const result = await think(makeDR({ prompt: 'test' }));
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  // T12
  test('payload.promptToExecute set when execute_prompt', async () => {
    const result = await think(makeDR({ prompt: 'echo hello' }));
    expect(result.payload.promptToExecute).toBe('echo hello');
  });

  // T13
  test('payload.optionChosen set when choose_option', async () => {
    const result = await think(makeDR({
      options: [{ label: 'B', description: 'option B', recommended: false }]
    }));
    expect(result.payload.optionChosen).toBeTruthy();
  });

  // T14
  test('payload.optionReasoning set when choose_option', async () => {
    const result = await think(makeDR({
      options: [{ label: 'A', description: 'fast', recommended: true }]
    }));
    expect(result.payload.optionReasoning).toBeTruthy();
  });

  // T15
  test('payload.answerToQuestion set when answer_question', async () => {
    const result = await think(makeDR({
      questions: [{ text: 'Continue?', answerType: 'confirm' }]
    }));
    expect(result.payload.answerToQuestion).toBeTruthy();
  });

  // T16
  test('payload.correctedPrompt set when retry_with_fix', async () => {
    const result = await think(makeDR({
      error: { message: 'ENOENT file missing', type: 'runtime', suggestion: 'create file' }
    }));
    expect(result.payload.correctedPrompt).toBeTruthy();
  });

  // T17
  test('payload.correctionExplanation set when retry_with_fix', async () => {
    const result = await think(makeDR({
      error: { message: 'syntax error', type: 'runtime', suggestion: 'fix syntax' }
    }));
    expect(result.payload.correctionExplanation).toBeTruthy();
  });

  // T18
  test('payload.completionAssessment set when mark_complete', async () => {
    const result = await think(makeDR({
      confirmation: { message: 'All tasks done', success: true }
    }));
    expect(result.payload.completionAssessment).toBeTruthy();
  });

  // T19
  test('nextAction always present non-empty', async () => {
    const result = await think(makeDR());
    expect(result.nextAction).toBeTruthy();
    expect(result.nextAction.length).toBeGreaterThan(0);
  });

  // T20
  test('projectInsight always present non-empty', async () => {
    const result = await think(makeDR({ prompt: 'build' }));
    expect(result.projectInsight).toBeTruthy();
    expect(result.projectInsight.length).toBeGreaterThan(0);
  });

  // T21
  test('extractedFacts is array', async () => {
    const result = await think(makeDR());
    expect(Array.isArray(result.extractedFacts)).toBe(true);
  });

  // T22
  test('analyzeError returns {rootCause, correctedPrompt, explanation, confidence}', async () => {
    const result = await analyzeError('TypeError: undefined is not a function', {});
    expect(result).toHaveProperty('rootCause');
    expect(result).toHaveProperty('correctedPrompt');
    expect(result).toHaveProperty('explanation');
    expect(result).toHaveProperty('confidence');
  });

  // T23
  test('generateAnswer with questions returns {answer} with non-empty answer', async () => {
    const result = await generateAnswer([{ text: 'Use TypeScript?', answerType: 'confirm' }], {}, []);
    expect(result).toHaveProperty('answer');
    expect(result.answer.length).toBeGreaterThan(0);
  });

  // T24
  test('evaluateCompletion with empty iterations returns complete=false', async () => {
    const result = await evaluateCompletion([], 'build app', '');
    expect(result.complete).toBe(false);
  });

  // T25
  test('evaluateCompletion with confirmation iteration returns complete=true', async () => {
    const result = await evaluateCompletion(
      [{ analysisType: 'confirmation', result: 'completed' }],
      'build app', ''
    );
    expect(result.complete).toBe(true);
  });

  // T26
  test('evaluateCompletion returns completionPercent number', async () => {
    const result = await evaluateCompletion(
      [{ result: 'step1 done' }, { result: 'step2 done' }],
      'build app', ''
    );
    expect(typeof result.completionPercent).toBe('number');
    expect(result.completionPercent).toBeGreaterThanOrEqual(0);
    expect(result.completionPercent).toBeLessThanOrEqual(100);
  });

  // T27
  test('think handles null deepReadResult gracefully (no crash)', async () => {
    const result = await think(null);
    // null becomes {}, !actionRequired is truthy so acknowledge_info
    expect(result.decision).toBe('acknowledge_info');
    expect(REQUIRED_KEYS.every(k => k in result)).toBe(true);
  });

  // T28
  test('think handles missing fields gracefully', async () => {
    const result = await think({});
    expect(result).toBeDefined();
    expect(REQUIRED_KEYS.every(k => k in result)).toBe(true);
  });

  // T29
  test('logDecision creates file in decisions/ dir', () => {
    logDecision({ sessionId: 'test-123' }, { decision: 'wait', reasoning: 'test', confidence: 50, nextAction: 'none' });
    const files = fs.readdirSync(DECISIONS_DIR);
    expect(files.length).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    expect(files.some(f => f.includes(today))).toBe(true);
  });

  // T30
  test('isAvailable returns {available, model, mode} with mode="rule-based"', () => {
    const result = isAvailable();
    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('mode');
    // No API key in test env
    expect(result.mode).toBe('rule-based');
  });
});
