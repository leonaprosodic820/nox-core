const { extractPrompt, extractTests, extractOptions, extractQuestions } = require('../parser');

// === extractPrompt ===

// T01
test('T01: extract basic content between [CC_START] and [CC_END]', () => {
  const result = extractPrompt('[CC_START]Hello world[CC_END]');
  expect(result).toEqual({ content: 'Hello world', flag: null });
});

// T02
test('T02: trims whitespace and newlines', () => {
  const result = extractPrompt('[CC_START]  \n  Hello world  \n  [CC_END]');
  expect(result.content).toBe('Hello world');
});

// T03
test('T03: returns null if [CC_START] absent', () => {
  const result = extractPrompt('Hello world [CC_END]');
  expect(result).toBeNull();
});

// T04
test('T04: returns null if [CC_END] absent', () => {
  const result = extractPrompt('[CC_START]Hello world');
  expect(result).toBeNull();
});

// T05
test('T05: returns {content:null, flag:empty_prompt} if content empty', () => {
  const result = extractPrompt('[CC_START]   [CC_END]');
  expect(result).toEqual({ content: null, flag: 'empty_prompt' });
});

// T06
test('T06: works with [cc_start] lowercase', () => {
  const result = extractPrompt('[cc_start]lowercase test[cc_end]');
  expect(result).toEqual({ content: 'lowercase test', flag: null });
});

// T07
test('T07: works with [CC-START] dash variant', () => {
  const result = extractPrompt('[CC-START]dash variant[CC-END]');
  expect(result).toEqual({ content: 'dash variant', flag: null });
});

// T08
test('T08: ignores text before and after tags', () => {
  const result = extractPrompt('Before text [CC_START]inner content[CC_END] after text');
  expect(result.content).toBe('inner content');
});

// T09
test('T09: handles multi-line prompt with code', () => {
  const input = `[CC_START]
Fix this function:
function add(a, b) {
  return a - b;
}
[CC_END]`;
  const result = extractPrompt(input);
  expect(result.content).toContain('function add');
  expect(result.content).toContain('return a - b');
  expect(result.flag).toBeNull();
});

// === extractOptions ===

// T10
test('T10: detects "Option A / Option B" pattern', () => {
  const input = 'Option A: Use React\nOption B: Use Vue';
  const result = extractOptions(input);
  expect(result).not.toBeNull();
  expect(result.length).toBe(2);
  expect(result[0].label).toBe('A');
  expect(result[1].label).toBe('B');
});

// T11
test('T11: detects numbered options with choice context word', () => {
  const input = 'Vous pouvez choisir:\n1. Premier choix\n2. Deuxieme choix\n3. Troisieme choix';
  const result = extractOptions(input);
  expect(result).not.toBeNull();
  expect(result.length).toBe(3);
  expect(result[0].label).toBe('1');
});

// T12
test('T12: detects "A) ... B) ... C)" pattern', () => {
  const input = 'A) Solution rapide\nB) Solution complete\nC) Solution hybride';
  const result = extractOptions(input);
  expect(result).not.toBeNull();
  expect(result.length).toBe(3);
});

// T13
test('T13: marks recommended=true when "recommande" present', () => {
  const input = 'Option A: Solution standard\nOption B: Solution optimale recommande';
  const result = extractOptions(input);
  expect(result).not.toBeNull();
  const rec = result.find(o => o.recommended === true);
  expect(rec).toBeDefined();
  expect(rec.label).toBe('B');
});

// T14
test('T14: marks recommended=true when star emoji present', () => {
  const input = 'Option A: Basic\nOption B: Premium \u2b50';
  const result = extractOptions(input);
  expect(result).not.toBeNull();
  const rec = result.find(o => o.recommended === true);
  expect(rec).toBeDefined();
  expect(rec.label).toBe('B');
});

// T15
test('T15: returns null if no option patterns', () => {
  const result = extractOptions('Just a regular sentence without options.');
  expect(result).toBeNull();
});

// T16
test('T16: handles 3 options A/B/C simultaneously', () => {
  const input = 'A) Alpha\nB) Beta\nC) Gamma';
  const result = extractOptions(input);
  expect(result).not.toBeNull();
  expect(result.length).toBe(3);
  expect(result[0].label).toBe('A');
  expect(result[1].label).toBe('B');
  expect(result[2].label).toBe('C');
});

// === extractTests ===

// T17
test('T17: extracts tests between [TEST_START] and [TEST_END]', () => {
  const input = '[TEST_START]\n1. Click button\n2. Check output\n[TEST_END]';
  const result = extractTests(input);
  expect(result).not.toBeNull();
  expect(result.length).toBe(2);
});

// T18
test('T18: parses "1. Action \u2192 Result" format', () => {
  const input = '[TEST_START]\n1. Click submit \u2192 Form is sent\n[TEST_END]';
  const result = extractTests(input);
  expect(result).not.toBeNull();
  expect(result[0].action).toBe('Click submit');
  expect(result[0].expected).toBe('Form is sent');
});

// T19
test('T19: extracts jsCommand if console.log present', () => {
  const input = '[TEST_START]\n1. console.log("test") \u2192 outputs test\n[TEST_END]';
  const result = extractTests(input);
  expect(result).not.toBeNull();
  expect(result[0].jsCommand).toBe('console.log("test")');
});

// T20
test('T20: returns null if no test section', () => {
  const result = extractTests('No test tags here');
  expect(result).toBeNull();
});

// === extractQuestions ===

// T21
test('T21: detects sentence ending with "?"', () => {
  const result = extractQuestions('What color do you prefer?');
  expect(result).not.toBeNull();
  expect(result[0].text).toBe('What color do you prefer?');
});

// T22
test('T22: detects "voulez-vous" without question mark', () => {
  const result = extractQuestions('Est-ce que voulez-vous continuer');
  expect(result).not.toBeNull();
  expect(result.length).toBe(1);
});

// T23
test('T23: sets answerType "confirm" for oui/non questions', () => {
  const result = extractQuestions('Voulez-vous continuer oui ou non?');
  expect(result).not.toBeNull();
  expect(result[0].answerType).toBe('confirm');
});

// T24
test('T24: returns null if no questions', () => {
  const result = extractQuestions('This is a simple statement.');
  expect(result).toBeNull();
});
