const fs = require('fs');
const path = require('path');

const PROJECTS_DIR = path.join(__dirname, '..', 'projects');

const {
  loadProject,
  saveProject,
  updateTask,
  addCompletedTask,
  recordDecision,
  detectTechStack,
  extractCodeContext,
  getRelevantContext,
  addKnownIssue,
  listProjects
} = require('../project-memory');

beforeEach(() => {
  // Clean projects/ dir
  if (fs.existsSync(PROJECTS_DIR)) {
    const files = fs.readdirSync(PROJECTS_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(PROJECTS_DIR, f));
    }
  } else {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  }
});

// T166
test('T166: loadProject creates new project if file does not exist', () => {
  const project = loadProject('test-project');
  expect(project).toHaveProperty('name', 'test-project');
  expect(project).toHaveProperty('createdAt');
  expect(project).toHaveProperty('objective');
  expect(project).toHaveProperty('techStack');
  expect(project).toHaveProperty('completedTasks');
  expect(project).toHaveProperty('currentTask');
  expect(project).toHaveProperty('sessions');
});

// T167
test('T167: loadProject loads existing project from disk', () => {
  const original = loadProject('persist-test');
  original.objective = 'Test objective';
  saveProject('persist-test', original);

  const loaded = loadProject('persist-test');
  expect(loaded.objective).toBe('Test objective');
});

// T168
test('T168: saveProject writes valid JSON file', () => {
  const project = loadProject('json-test');
  saveProject('json-test', project);

  const filePath = path.join(PROJECTS_DIR, 'json-test.json');
  expect(fs.existsSync(filePath)).toBe(true);

  const content = fs.readFileSync(filePath, 'utf-8');
  expect(() => JSON.parse(content)).not.toThrow();
});

// T169
test('T169: updateTask changes currentTask field', () => {
  loadProject('task-test');
  const updated = updateTask('task-test', 'Build login page');
  expect(updated.currentTask).toBe('Build login page');
});

// T170
test('T170: addCompletedTask adds to completedTasks array', () => {
  loadProject('completed-test');
  const updated = addCompletedTask('completed-test', 'Setup database');
  expect(updated.completedTasks).toContain('Setup database');
});

// T171
test('T171: recordDecision adds to decisions array', () => {
  loadProject('decision-test');
  const updated = recordDecision('decision-test', {
    decision: 'use-postgres',
    reasoning: 'Better for relational data',
    confidence: 0.9
  });
  expect(updated.decisions.length).toBe(1);
  expect(updated.decisions[0].type).toBe('use-postgres');
  expect(updated.decisions[0].reasoning).toBe('Better for relational data');
});

// T172
test('T172: detectTechStack finds Node.js and Express', () => {
  const stack = detectTechStack('Using Node.js with express');
  expect(stack).toContain('Node.js');
  expect(stack).toContain('Express');
});

// T173
test('T173: detectTechStack finds React and TypeScript', () => {
  const stack = detectTechStack('React TypeScript app');
  expect(stack).toContain('React');
  expect(stack).toContain('TypeScript');
});

// T174
test('T174: extractCodeContext extracts ports 3000 and 8080', () => {
  const ctx = extractCodeContext('PORT 3000 and port 8080');
  expect(ctx.ports).toContain(3000);
  expect(ctx.ports).toContain(8080);
});

// T175
test('T175: extractCodeContext extracts file names', () => {
  const ctx = extractCodeContext('server.js and utils.ts files');
  expect(ctx.files).toEqual(expect.arrayContaining(['server.js', 'utils.ts']));
});

// T176
test('T176: getRelevantContext returns object with objective, currentTask, techStack', () => {
  loadProject('context-test');
  updateTask('context-test', 'Current work');
  const ctx = getRelevantContext('context-test', 'what am I doing');
  expect(ctx).toHaveProperty('objective');
  expect(ctx).toHaveProperty('currentTask', 'Current work');
  expect(ctx).toHaveProperty('techStack');
});

// T177
test('T177: loadProject with sessionId added to sessions array', () => {
  const project = loadProject('session-test');
  project.sessions.push('session-abc-123');
  saveProject('session-test', project);

  const reloaded = loadProject('session-test');
  expect(reloaded.sessions).toContain('session-abc-123');
});

// T178
test('T178: saveProject updates updatedAt field', () => {
  const project = loadProject('updated-test');
  const firstUpdate = project.updatedAt;

  // Small delay to ensure different timestamp
  const later = new Date(Date.now() + 1000).toISOString();
  project.updatedAt = '2000-01-01T00:00:00.000Z'; // force old date
  saveProject('updated-test', project);

  const reloaded = loadProject('updated-test');
  // saveProject sets updatedAt, so it should be different from the forced old date
  expect(reloaded.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
});

// T179
test('T179: addKnownIssue twice with same issue results in no duplicate', () => {
  loadProject('issue-test');
  addKnownIssue('issue-test', 'Memory leak in worker');
  const project = addKnownIssue('issue-test', 'Memory leak in worker');
  const count = project.knownIssues.filter(i => i === 'Memory leak in worker').length;
  expect(count).toBe(1);
});

// T180
test('T180: loadProject then set objective, save, reload preserves objective', () => {
  const project = loadProject('objective-test');
  project.objective = 'Build a REST API';
  saveProject('objective-test', project);

  const reloaded = loadProject('objective-test');
  expect(reloaded.objective).toBe('Build a REST API');
});
