const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, '..', 'decisions');

const {
  validateClaudeCodeRequest,
  generateYesResponse,
  setBroadcast,
  logValidation,
  SAFE_PATTERNS,
  DANGEROUS_PATTERNS
} = require('../auto-validator');

beforeEach(() => {
  // Clean decisions/ dir
  if (fs.existsSync(DECISIONS_DIR)) {
    const files = fs.readdirSync(DECISIONS_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(DECISIONS_DIR, f));
    }
  } else {
    fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  }
  // Set a mock broadcast
  setBroadcast(jest.fn());
});

afterAll(() => {
  setBroadcast(null);
});

// T151
test('T151: "Do you want to proceed?" returns approved:true', () => {
  const result = validateClaudeCodeRequest('Do you want to proceed?');
  expect(result.approved).toBe(true);
});

// T152
test('T152: "Continue?" returns approved:true', () => {
  const result = validateClaudeCodeRequest('Continue?');
  expect(result.approved).toBe(true);
});

// T153
test('T153: "[Y/n]" returns response "y"', () => {
  const result = validateClaudeCodeRequest('Apply changes? [Y/n]');
  expect(result.response).toBe('y');
});

// T154
test('T154: "(yes/no)" returns response "yes"', () => {
  const result = validateClaudeCodeRequest('Are you sure? (yes/no)');
  expect(result.response).toBe('yes');
});

// T155
test('T155: "> 1. Yes" returns response "1"', () => {
  const result = validateClaudeCodeRequest('Choose option: > 1. Yes');
  expect(result.response).toBe('1');
});

// T156
test('T156: "proceed with playwright — Click" returns response "2"', () => {
  const result = validateClaudeCodeRequest('proceed with playwright — Click');
  expect(result.response).toBe('2');
});

// T157
test('T157: "rm -rf /" returns approved:false, escalated:true', () => {
  const result = validateClaudeCodeRequest('rm -rf /');
  expect(result.approved).toBe(false);
  expect(result.escalated).toBe(true);
});

// T158
test('T158: "Delete all?" returns approved:false without escalation', () => {
  const result = validateClaudeCodeRequest('Delete all?');
  expect(result.approved).toBe(false);
  expect(result.escalated).toBeFalsy();
});

// T159
test('T159: logValidation creates file in decisions/ dir', () => {
  logValidation('test request', { approved: true, response: 'yes', reason: 'test' });
  const files = fs.readdirSync(DECISIONS_DIR);
  const validationFiles = files.filter(f => f.startsWith('validations-'));
  expect(validationFiles.length).toBeGreaterThan(0);
});

// T160
test('T160: setBroadcast mock receives auto_validated event after validation', () => {
  const mockBroadcast = jest.fn();
  setBroadcast(mockBroadcast);
  validateClaudeCodeRequest('Continue?');
  expect(mockBroadcast).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'auto_validated' })
  );
});

// T161
test('T161: broadcast function is called during validation', () => {
  const mockBroadcast = jest.fn();
  setBroadcast(mockBroadcast);
  validateClaudeCodeRequest('Some random request');
  expect(mockBroadcast).toHaveBeenCalled();
});

// T162
test('T162: generateYesResponse returns correct values for [Y/n] and (yes/no)', () => {
  expect(generateYesResponse('[Y/n]')).toBe('y');
  expect(generateYesResponse('(yes/no)')).toBe('yes');
});

// T163
test('T163: 10 validations in rapid succession do not crash', () => {
  const requests = [
    'Continue?', 'Proceed?', 'Confirm?', '[Y/n]', '(yes/no)',
    'Install package npm?', 'Run command?', 'Overwrite?', 'Create file?', 'Do it?'
  ];
  expect(() => {
    for (const req of requests) {
      validateClaudeCodeRequest(req);
    }
  }).not.toThrow();
});

// T164
test('T164: "Install package npm?" returns approved:true (non-destructive)', () => {
  const result = validateClaudeCodeRequest('Install package npm?');
  expect(result.approved).toBe(true);
});

// T165
test('T165: "sudo rm -rf /tmp" returns approved:false, escalated:true', () => {
  const result = validateClaudeCodeRequest('sudo rm -rf /tmp');
  expect(result.approved).toBe(false);
  expect(result.escalated).toBe(true);
});
