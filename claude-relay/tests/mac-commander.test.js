const fs = require('fs');
const path = require('path');
const macCmd = require('../mac-commander');

const TMP_PREFIX = `/tmp/relay-test-${Date.now()}`;
const tmpFiles = [];

function tmpFile(ext = '.txt') {
  const f = `${TMP_PREFIX}-${tmpFiles.length}${ext}`;
  tmpFiles.push(f);
  return f;
}

afterAll(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch {}
  }
});

// T1
test('takeScreenshot returns Buffer with length > 0', () => {
  const buf = macCmd.takeScreenshot();
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(0);
});

// T2
test('takeScreenshot buffer starts with PNG signature', () => {
  const buf = macCmd.takeScreenshot();
  const sig = buf.readUInt32BE(0);
  expect(sig).toBe(0x89504e47);
});

// T3
test('getScreenInfo returns object with frontApp string', () => {
  const info = macCmd.getScreenInfo();
  expect(info).toBeDefined();
  expect(typeof info.frontApp).toBe('string');
  expect(info.frontApp.length).toBeGreaterThan(0);
});

// T4
test('files.write creates file and files.read reads it back', () => {
  const f = tmpFile();
  const content = `test-content-${Date.now()}`;
  macCmd.files.write(f, content);
  const result = macCmd.files.read(f);
  expect(result).toBe(content);
});

// T5
test('files.list returns array for /tmp', () => {
  const list = macCmd.files.list('/tmp');
  expect(Array.isArray(list)).toBe(true);
  expect(list.length).toBeGreaterThan(0);
});

// T6
test('files.exists returns true for existing file, false for nonexistent', () => {
  const f = tmpFile();
  macCmd.files.write(f, 'exists');
  expect(macCmd.files.exists(f)).toBe(true);
  expect(macCmd.files.exists(`/tmp/nonexistent-${Date.now()}-xyz`)).toBe(false);
});

// T7
test('files.copy copies file correctly', () => {
  const src = tmpFile();
  const dst = tmpFile();
  const content = `copy-test-${Date.now()}`;
  macCmd.files.write(src, content);
  macCmd.files.copy(src, dst);
  expect(fs.readFileSync(dst, 'utf-8')).toBe(content);
});

// T8
test('files.uploadToRemote returns fileId, url, originalName', () => {
  const f = tmpFile();
  macCmd.files.write(f, 'upload-test');
  const result = macCmd.files.uploadToRemote(f);
  expect(result).toHaveProperty('fileId');
  expect(result).toHaveProperty('url');
  expect(result).toHaveProperty('originalName');
  expect(typeof result.fileId).toBe('string');
  expect(result.url).toContain('/remote/files/download/');
});

// T9
test('files.getDownload returns entry for valid fileId', () => {
  const f = tmpFile();
  macCmd.files.write(f, 'download-test');
  const uploaded = macCmd.files.uploadToRemote(f);
  const entry = macCmd.files.getDownload(uploaded.fileId);
  expect(entry).not.toBeNull();
  expect(entry).toHaveProperty('path');
  expect(entry).toHaveProperty('originalName');
});

// T10
test('system.runCommand("echo hello") stdout contains hello', () => {
  const result = macCmd.system.runCommand('echo hello');
  expect(result.stdout).toContain('hello');
  expect(result.exitCode).toBe(0);
});

// T11
test('system.runCommand("rm -rf /") throws with BLOCKED', () => {
  expect(() => macCmd.system.runCommand('rm -rf /')).toThrow(/BLOCKED/);
});

// T12
test('system.runCommand("mkfs") throws with BLOCKED', () => {
  expect(() => macCmd.system.runCommand('mkfs')).toThrow(/BLOCKED/);
});

// T13
test('clipboard write then read returns same value', () => {
  const unique = `relay-clipboard-test-${Date.now()}`;
  macCmd.system.clipboard.write(unique);
  const result = macCmd.system.clipboard.read();
  expect(result).toBe(unique);
});

// T14
test('system.getRunningApps returns non-empty array', () => {
  const apps = macCmd.system.getRunningApps();
  expect(Array.isArray(apps)).toBe(true);
  expect(apps.length).toBeGreaterThan(0);
});

// T15
test('system.getSystemInfo returns object with cpu and disk', () => {
  const info = macCmd.system.getSystemInfo();
  expect(info).toHaveProperty('cpu');
  expect(info).toHaveProperty('disk');
  expect(typeof info.cpu).toBe('string');
  expect(typeof info.disk).toBe('string');
});

// T16
test('claudeCode.isRunning returns boolean', () => {
  const result = macCmd.claudeCode.isRunning();
  expect(typeof result).toBe('boolean');
});

// T17
test('checkDangerous("echo hi") does NOT throw', () => {
  expect(() => macCmd.checkDangerous('echo hi')).not.toThrow();
});

// T18
test('checkDangerous("rm -rf /") throws', () => {
  expect(() => macCmd.checkDangerous('rm -rf /')).toThrow();
});

// T19
test('resolvePath("~/test") starts with /Users/', () => {
  const resolved = macCmd.resolvePath('~/test');
  expect(resolved).toMatch(/^\/Users\//);
});

// T20
test('resolvePath("/tmp/test") returns "/tmp/test" unchanged', () => {
  expect(macCmd.resolvePath('/tmp/test')).toBe('/tmp/test');
});
