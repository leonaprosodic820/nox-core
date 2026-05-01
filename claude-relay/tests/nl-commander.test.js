const fs = require('fs');
const path = require('path');
const nlCmd = require('../nl-commander');

const HISTORY_FILE = path.join(__dirname, '..', 'logs', 'nl-history.json');

beforeEach(() => {
  try { fs.unlinkSync(HISTORY_FILE); } catch {}
});

// T1
test('detectIntent("screenshot") returns {fn:"takeScreenshot"}', () => {
  const result = nlCmd.detectIntent('screenshot');
  expect(result).not.toBeNull();
  expect(result.fn).toBe('takeScreenshot');
});

// T2
test('detectIntent("ouvre safari sur google.com") returns safari.openURL with google url', () => {
  const result = nlCmd.detectIntent('ouvre safari sur google.com');
  expect(result).not.toBeNull();
  expect(result.fn).toBe('safari.openURL');
  expect(result.args.url).toMatch(/google/i);
});

// T3
test('detectIntent("status mac") returns {fn:"system.getSystemInfo"}', () => {
  const result = nlCmd.detectIntent('status mac');
  expect(result).not.toBeNull();
  expect(result.fn).toBe('system.getSystemInfo');
});

// T4
test('detectIntent("lock") returns {fn:"system.lock"}', () => {
  const result = nlCmd.detectIntent('lock');
  expect(result).not.toBeNull();
  expect(result.fn).toBe('system.lock');
});

// T5
test('detectIntent("clipboard") returns {fn:"system.clipboard.read"}', () => {
  const result = nlCmd.detectIntent('clipboard');
  expect(result).not.toBeNull();
  expect(result.fn).toBe('system.clipboard.read');
});

// T6
test('detectIntent("apps actives") returns {fn:"system.getRunningApps"}', () => {
  const result = nlCmd.detectIntent('apps actives');
  expect(result).not.toBeNull();
  expect(result.fn).toBe('system.getRunningApps');
});

// T7
test('detectIntent("unknown gibberish") returns null', () => {
  const result = nlCmd.detectIntent('xyzzy blorf quux');
  expect(result).toBeNull();
});

// T8
test('interpretAndExecute("screenshot") returns {success:true} with image', async () => {
  const result = await nlCmd.interpretAndExecute('screenshot');
  expect(result.success).toBe(true);
  expect(result.results.length).toBeGreaterThan(0);
  expect(result.results[0].result).toHaveProperty('image');
});

// T9
test('interpretAndExecute("rm -rf /") returns {success:false}', async () => {
  const result = await nlCmd.interpretAndExecute('rm -rf /');
  expect(result.success).toBe(false);
});

// T10
test('interpretAndExecute("status") returns {success:true}', async () => {
  const result = await nlCmd.interpretAndExecute('status');
  expect(result.success).toBe(true);
});

// T11
test('getAvailableFunctions returns non-empty array', () => {
  const fns = nlCmd.getAvailableFunctions();
  expect(Array.isArray(fns)).toBe(true);
  expect(fns.length).toBeGreaterThan(0);
});

// T12
test('FUNCTION_MAP has takeScreenshot key', () => {
  expect(nlCmd.FUNCTION_MAP).toHaveProperty('takeScreenshot');
  expect(typeof nlCmd.FUNCTION_MAP['takeScreenshot']).toBe('function');
});

// T13
test('saveHistory saves and getHistory reads it back', () => {
  nlCmd.saveHistory('test order', { success: true, timestamp: new Date().toISOString() });
  const history = nlCmd.getHistory();
  expect(Array.isArray(history)).toBe(true);
  expect(history.length).toBeGreaterThan(0);
  expect(history[0].order).toBe('test order');
});

// T14
test('interpretAndExecute calls onStep callback at least once', async () => {
  const steps = [];
  await nlCmd.interpretAndExecute('screenshot', (step) => steps.push(step));
  expect(steps.length).toBeGreaterThanOrEqual(1);
});

// T15
test('3 sequential interpretAndExecute calls do not crash', async () => {
  const r1 = await nlCmd.interpretAndExecute('status');
  const r2 = await nlCmd.interpretAndExecute('clipboard');
  const r3 = await nlCmd.interpretAndExecute('status');
  expect(r1).toHaveProperty('orderId');
  expect(r2).toHaveProperty('orderId');
  expect(r3).toHaveProperty('orderId');
});
