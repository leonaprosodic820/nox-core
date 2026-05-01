const sovereignty = require('./sovereignty-engine');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { analyze } = require('./analyzer');
const { notify } = require('./notifier');
const responseReader = require('./response-reader');
const superBrain = require('./super-brain');
const decisionEngine = require('./decision-engine');
const autoValidator = require('./auto-validator');
const projectMemory = require('./project-memory');
const watchdog = require('./watchdog');

let macCmd, nlCmd, claudeChat, screenStreamer, remoteAuth, vision, videoRecorder, streamManager;
let omegaNav, qualityGate, knowledgeBase, perfTracker;
let prometheus, securityFortress, selfHealer, contextOmniscient, zeroTrust;
try { macCmd = require('./mac-commander'); } catch (e) { macCmd = null; }
try { nlCmd = require('./nl-commander'); } catch (e) { nlCmd = null; }
try { claudeChat = require('./claude-chat-reader'); } catch (e) { claudeChat = null; }
try { vision = require('./vision-engine'); } catch (e) { vision = null; }
try { videoRecorder = require('./video-recorder'); } catch (e) { videoRecorder = null; }
try { streamManager = require('./stream-manager'); } catch (e) { streamManager = null; }
try { screenStreamer = require('./screen-streamer'); } catch (e) { screenStreamer = null; }
try { omegaNav = require('./omega-navigator'); } catch (e) { omegaNav = null; }
try { qualityGate = require('./quality-gate'); } catch (e) { qualityGate = null; }
try { knowledgeBase = require('./knowledge-base'); } catch (e) { knowledgeBase = null; }
try { perfTracker = require('./performance-tracker'); } catch (e) { perfTracker = null; }
try { prometheus = require('./prometheus'); } catch (e) { prometheus = null; }
try { securityFortress = require('./security-fortress'); } catch (e) { securityFortress = null; }
try { selfHealer = require('./self-healer'); } catch (e) { selfHealer = null; }
try { contextOmniscient = require('./context-omniscient'); } catch (e) { contextOmniscient = null; }
try { remoteAuth = require('./remote-auth'); } catch (e) { remoteAuth = null; }

let vectorMem, multiAgents, selfImprove, missionRunner;
try { vectorMem = require('./vector-memory'); } catch (e) { vectorMem = null; }
try { multiAgents = require('./multi-agents'); } catch (e) { multiAgents = null; }
try { selfImprove = require('./self-improve'); } catch (e) { selfImprove = null; }
try { missionRunner = require('./missions'); } catch (e) { missionRunner = null; }

let ragEngine, knowledgeGraph, modelRouter, temporalDaemon, commandSandbox;
try { ragEngine = require('./rag-engine'); } catch (e) { ragEngine = null; }
try { knowledgeGraph = require('./knowledge-graph'); } catch (e) { knowledgeGraph = null; }
try { modelRouter = require('./model-router'); } catch (e) { modelRouter = null; }
try { temporalDaemon = require('./temporal-daemon'); } catch (e) { temporalDaemon = null; }
try { commandSandbox = require('./command-sandbox'); } catch (e) { commandSandbox = null; }
try { var treeOfThoughts = require('./tree-of-thoughts'); } catch(e) { treeOfThoughts = null; }
try { var adversarialCritic = require('./adversarial-critic'); } catch(e) { adversarialCritic = null; }
try { var sensoryMemory = require('./sensory-memory'); } catch(e) { sensoryMemory = null; }
try { var taskCompiler = require('./task-compiler'); } catch(e) { taskCompiler = null; }
try { var selfAwareness = require('./self-awareness'); } catch(e) { selfAwareness = null; }
try { var persistentIdentity = require('./persistent-identity'); } catch(e) { persistentIdentity = null; }
try { var p2pSync = require('./p2p-sync'); } catch(e) { p2pSync = null; }
try { var episodicMem = require('./episodic-memory'); } catch(e) { episodicMem = null; }
try { var autoDoc = require('./auto-doc'); } catch(e) { autoDoc = null; }
try { var causalEngine = require('./causal-engine'); } catch(e) { causalEngine = null; }
try { var macOptimizer = require('./mac-optimizer'); } catch(e) { macOptimizer = null; }
try { var icloudMgr = require('./icloud-manager'); } catch(e) { icloudMgr = null; }
try { var macCtrl = require('./mac-control'); } catch(e) { macCtrl = null; }
try { var ccBridge = require('./claude-code-bridge'); } catch(e) { ccBridge = null; }
try { var emailMgr = require('./email-manager'); } catch(e) { emailMgr = null; }
try { var designGen = require('./design-generator'); } catch(e) { designGen = null; }
try { var hfImage = require('./hf-image'); } catch(e) { hfImage = null; }
try { var webDeploy = require('./web-deployer'); } catch(e) { webDeploy = null; }

const streamBridge = require('./claude-stream-bridge');
const cogProfile = require('./cognitive-profile');
const existEngine = require('./existential-engine');
const identityCore = require('./identity-core');
const cogModule = require('./cognitive-module');
const sseStreamMgr = require('./sse-stream-manager');
const cogMissionRunner = require('./mission-runner');
const { analyze: cogAnalyze } = require('./analyze-module');
const proactiveAlerts = require('./proactive-alerts');
const longTermMemory  = require('./long-term-memory');
const { AgentOrchestrator } = require('./specialized-agents');
const pushNotif = require('./push-notifications');
const selfImproveModule = require('./self-improvement');
const rlModule = require('./reinforcement-learning');
const empathyEngine = require('./empathy-engine');
const totpAuth = require('./totp-auth');
const projMemory = require('./project-memory');
const analytics = require('./analytics-tracker');
const backupMgr = require('./backup');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const LOGS_DIR = path.join(__dirname, 'logs');

fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (sovereignty.isKillSwitchActive()) return res.status(503).json({ error: 'PROMETHEUS stopped', code: 'KILLED' });
  if (req.body?.message && sovereignty.detectStopKeyword(req.body.message)) {
    sovereignty.killSwitch('stop_keyword');
    return res.json({ message: 'PROMETHEUS stopped — stop keyword detected' });
  }
  const cls = sovereignty.classifyRoute(req.method, req.path);
  sovereignty.auditLog('INFO', req.method + ' ' + req.path, '', cls);
  if (cls === 'BLOCKED') return res.status(403).json({ error: 'Blocked by Sovereignty Engine' });
  next();
});
app.use(cookieParser());
app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/remote', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'remote.html'));
});

fs.mkdirSync(path.join(__dirname, 'projects'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'decisions'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });

const instances = new Map();
const INSTANCES_FILE = path.join(__dirname, 'instances', 'active.json');
fs.mkdirSync(path.dirname(INSTANCES_FILE), { recursive: true });

function loadInstances() {
  try {
    const data = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf-8'));
    Object.entries(data).forEach(([id, inst]) => {
      const session = readSession(inst.sessionId);
      if (session && session.status === 'active') {
        inst.status = 'idle';
        inst.lastActiveAt = new Date().toISOString();
        instances.set(id, inst);
      }
    });
    if (instances.size > 0) console.log(`  [Instances] Restored: ${instances.size}`);
  } catch {}
}

function saveInstances() {
  const data = {};
  instances.forEach((v, k) => { data[k] = v; });
  try { fs.writeFileSync(INSTANCES_FILE, JSON.stringify(data, null, 2)); } catch {}
}

loadInstances();

function log(event, id, detail) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19);
  const line = `[${time}] [${event}] ${id || '-'} | ${detail}\n`;
  try { fs.appendFileSync(path.join(LOGS_DIR, `${date}.log`), line); } catch {}
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function readSession(id) {
  if (!id || typeof id !== 'string') return null;
  const safe = id.replace(/[^a-zA-Z0-9-]/g, '');
  const file = path.join(SESSIONS_DIR, `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeSession(session) {
  session.updatedAt = new Date().toISOString();
  const safe = session.id.replace(/[^a-zA-Z0-9-]/g, '');
  fs.writeFileSync(path.join(SESSIONS_DIR, `${safe}.json`), JSON.stringify(session, null, 2));
}

// ── SESSION ROUTES ──

app.get('/sessions', (req, res) => {
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions = files.map(f => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
      return { id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt, status: s.status, currentIteration: s.currentIteration };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  res.json(sessions);
});

app.post('/sessions/new', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  const session = {
    id, name: name.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    currentIteration: 0,
    iterations: []
  };
  writeSession(session);
  log('SESSION_NEW', id, name.trim());
  res.json({ id, name: session.name, createdAt: session.createdAt });
});

app.get('/sessions/:id', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.post('/sessions/:id/ingest', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const analysis = analyze(text);
  const iteration = {
    index: session.iterations.length, rawInput: text, analysisType: analysis.type,
    prompt: analysis.elements.prompt, result: null, options: analysis.elements.options,
    chosenOption: null, tests: analysis.elements.tests, testResults: null,
    questions: analysis.elements.questions, answers: null, timestamp: new Date().toISOString()
  };
  session.iterations.push(iteration);
  session.currentIteration = iteration.index;
  writeSession(session);

  log('INGEST', session.id, `type=${analysis.type} confidence=${analysis.confidence}`);
  broadcast({ event: 'analyzed', sessionId: session.id, iteration: iteration.index, analysis });
  res.json({ success: true, analysis });
});

app.post('/sessions/:id/result', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { result } = req.body;
  if (!result) return res.status(400).json({ error: 'result required' });

  const iter = session.iterations[session.currentIteration];
  if (iter) iter.result = result;
  session.currentIteration++;
  writeSession(session);

  log('RESULT', session.id, `iteration=${session.currentIteration - 1}`);
  broadcast({ event: 'result_saved', sessionId: session.id, iteration: session.currentIteration - 1 });
  res.json({ success: true, nextIteration: session.currentIteration });
});

app.post('/sessions/:id/option', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { chosenOption } = req.body;
  if (!chosenOption) return res.status(400).json({ error: 'chosenOption required' });

  const iter = session.iterations[session.currentIteration];
  if (iter) iter.chosenOption = chosenOption;
  const generatedPrompt = `[CC_START]\nOption choisie : ${chosenOption}\nContinuer avec cette option.\n[CC_END]`;
  writeSession(session);

  log('OPTION', session.id, chosenOption);
  broadcast({ event: 'option_chosen', sessionId: session.id, prompt: generatedPrompt });
  res.json({ success: true, generatedPrompt });
});

app.post('/sessions/:id/answer', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { questionIndex, answer } = req.body;
  const iter = session.iterations[session.currentIteration];
  if (!iter) return res.status(400).json({ error: 'No current iteration' });

  if (!iter.answers) iter.answers = [];
  const q = iter.questions && iter.questions[questionIndex];
  iter.answers.push({ question: q ? q.text : `Question ${questionIndex}`, answer });

  let responseText = '';
  if (iter.questions && iter.answers.length >= iter.questions.length) {
    responseText = iter.answers.map(a => `Q: ${a.question}\nR: ${a.answer}`).join('\n\n');
  }
  writeSession(session);
  log('ANSWER', session.id, `q=${questionIndex}`);
  broadcast({ event: 'answer_ready', sessionId: session.id, responseText });
  res.json({ success: true, responseText });
});

app.post('/sessions/:id/complete', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.status = 'completed';
  writeSession(session);
  log('COMPLETE', session.id, 'Session completed');
  broadcast({ event: 'session_completed', sessionId: session.id });
  notify({ message: `${session.name} \u2014 Session terminee`, sound: 'success' });
  res.json({ success: true });
});

app.get('/sessions/:id/history', (req, res) => {
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ id: session.id, name: session.name, iterations: session.iterations });
});

// ── INSTANCE ROUTES ──

app.get('/instances', (req, res) => {
  res.json(Array.from(instances.values()).map(i => ({
    instanceId: i.instanceId, label: i.label, projectName: i.projectName,
    cliNumber: i.cliNumber, sessionId: i.sessionId, status: i.status
  })));
});

app.post('/instances/register', (req, res) => {
  const { projectName, cliNumber, sessionId } = req.body;
  if (!projectName || cliNumber == null || !sessionId) {
    return res.status(400).json({ error: 'projectName, cliNumber, sessionId required' });
  }
  const session = readSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const existing = Array.from(instances.values()).find(
    i => i.projectName === projectName && i.cliNumber === cliNumber
  );
  if (existing) return res.json({ instanceId: existing.instanceId, label: existing.label, already_exists: true });

  const instanceId = uuidv4();
  const label = `${projectName} \u2014 CLI-${cliNumber}`;
  const instance = {
    instanceId, projectName, cliNumber, label, sessionId,
    status: 'idle', createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString()
  };
  instances.set(instanceId, instance);
  saveInstances();

  log('INSTANCE_REG', instanceId, label);
  broadcast({ event: 'instance_registered', instance });
  notify({ message: `Nouvelle instance : ${label}`, instanceLabel: label, sound: 'info' });
  res.json({ instanceId, label });
});

app.delete('/instances/:instanceId', (req, res) => {
  const { instanceId } = req.params;
  if (!instances.has(instanceId)) return res.status(404).json({ error: 'Instance not found' });
  instances.delete(instanceId);
  saveInstances();
  log('INSTANCE_DEL', instanceId, 'removed');
  broadcast({ event: 'instance_removed', instanceId });
  res.json({ success: true });
});

app.post('/instances/:instanceId/ingest', (req, res) => {
  const inst = instances.get(req.params.instanceId);
  if (!inst) return res.status(404).json({ error: 'Instance not found' });
  const session = readSession(inst.sessionId);
  if (!session) return res.status(404).json({ error: 'Linked session not found' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  inst.status = 'processing';
  inst.lastActiveAt = new Date().toISOString();

  const analysis = analyze(text);
  const iteration = {
    index: session.iterations.length, rawInput: text, analysisType: analysis.type,
    prompt: analysis.elements.prompt, result: null, options: analysis.elements.options,
    chosenOption: null, tests: analysis.elements.tests, testResults: null,
    questions: analysis.elements.questions, answers: null,
    instanceId: inst.instanceId, instanceLabel: inst.label,
    timestamp: new Date().toISOString()
  };
  session.iterations.push(iteration);
  session.currentIteration = iteration.index;
  writeSession(session);

  inst.status = 'waiting_result';
  saveInstances();

  log('INSTANCE_INGEST', inst.instanceId, `type=${analysis.type}`);
  broadcast({ event: 'analyzed', instanceId: inst.instanceId, label: inst.label, sessionId: inst.sessionId, iteration: iteration.index, analysis });
  res.json({ success: true, analysis });
});

app.post('/instances/:instanceId/result', (req, res) => {
  const inst = instances.get(req.params.instanceId);
  if (!inst) return res.status(404).json({ error: 'Instance not found' });
  const session = readSession(inst.sessionId);
  if (!session) return res.status(404).json({ error: 'Linked session not found' });
  const { result } = req.body;
  if (!result) return res.status(400).json({ error: 'result required' });

  const iter = session.iterations[session.currentIteration];
  if (iter) iter.result = result;
  session.currentIteration++;
  writeSession(session);

  inst.status = 'idle';
  inst.lastActiveAt = new Date().toISOString();
  saveInstances();

  log('INSTANCE_RESULT', inst.instanceId, `iteration=${session.currentIteration - 1}`);
  broadcast({ event: 'result_saved', instanceId: inst.instanceId, label: inst.label, sessionId: inst.sessionId, iteration: session.currentIteration - 1 });
  notify({ message: `${inst.label} \u2014 Resultat recu`, instanceLabel: inst.label, sound: 'success' });
  res.json({ success: true, nextIteration: session.currentIteration });
});

app.get('/instances/:instanceId/status', (req, res) => {
  const inst = instances.get(req.params.instanceId);
  if (!inst) return res.status(404).json({ error: 'Instance not found' });
  res.json({ instanceId: inst.instanceId, label: inst.label, status: inst.status, lastActiveAt: inst.lastActiveAt });
});

// ── BRAIN & DECISION ROUTES ──

decisionEngine.setBroadcast(broadcast);
autoValidator.setBroadcast(broadcast);

const autoModeInstances = new Set();

app.get('/brain/status', (req, res) => {
  const status = superBrain.isAvailable();
  const stats = decisionEngine.getStats();
  res.json({ ...status, totalDecisions: stats.totalDecisionsToday });
});

app.post('/brain/decide', async (req, res) => {
  const { sessionId, instanceId, text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const dr = responseReader.deepRead(text);
  const result = await superBrain.think(dr, { sessionId, instanceId });
  res.json({ success: true, decision: result });
});

app.get('/decisions', (req, res) => {
  res.json(decisionEngine.getDecisions());
});

app.get('/decisions/:sessionId', (req, res) => {
  const all = decisionEngine.getDecisions();
  res.json(all.filter(d => d.sessionId === req.params.sessionId));
});

app.get('/projects', (req, res) => {
  res.json(projectMemory.listProjects());
});

app.get('/projects/:name', (req, res) => {
  const project = projectMemory.loadProject(req.params.name);
  res.json(project);
});

app.post('/projects/:name/objective', (req, res) => {
  const { objective } = req.body;
  if (!objective) return res.status(400).json({ error: 'objective required' });
  const project = projectMemory.loadProject(req.params.name);
  project.objective = objective;
  projectMemory.saveProject(req.params.name, project);
  res.json({ success: true });
});

app.get('/ios-shortcuts', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'ios-shortcuts.html')));

app.get('/health', (req, res) => {
  const ob = require('./omega-brain');
  res.json({
    system: 'PROMETHEUS v10.0', version: '10.0.0',
    healthy: true, timestamp: new Date().toISOString(),
    uptime: process.uptime(), pid: process.pid,
    brain: ob.getStatus(), instances: instances.size,
    memory: process.memoryUsage(),
    disk: watchdog.getSessionsDiskUsage()
  });
});

app.post('/instances/:instanceId/auto-mode', (req, res) => {
  const { instanceId } = req.params;
  const { enabled } = req.body;
  if (!instances.has(instanceId)) return res.status(404).json({ error: 'Instance not found' });
  if (enabled) autoModeInstances.add(instanceId);
  else autoModeInstances.delete(instanceId);
  broadcast({ event: 'auto_mode_changed', instanceId, enabled: !!enabled });
  res.json({ success: true, autoMode: !!enabled });
});

app.post('/validate', (req, res) => {
  const { request } = req.body;
  if (!request) return res.status(400).json({ error: 'request required' });
  const result = autoValidator.validateClaudeCodeRequest(request);
  res.json(result);
});

app.get('/relay/stats', (req, res) => {
  const stats = decisionEngine.getStats();
  res.json({
    ...stats,
    uptime: process.uptime(),
    totalSessions: fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).length,
    activeInstances: instances.size,
    autoModeInstances: autoModeInstances.size
  });
});

// ── REMOTE AUTH ROUTES ──

if (remoteAuth) {
  app.post('/remote/login', remoteAuth.loginLimiter, remoteAuth.handleLogin);
  app.post('/remote/logout', remoteAuth.requireAuth, remoteAuth.handleLogout);
}

const requireRemoteAuth = remoteAuth ? remoteAuth.requireAuth : (req, res, next) => next();
const localOrAuth = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
  return requireRemoteAuth(req, res, next);
};

// ── REMOTE ROUTES ──

app.post('/remote/command', requireRemoteAuth, async (req, res) => {
  const { order } = req.body;
  if (!order) return res.status(400).json({ error: 'order required' });
  if (!nlCmd) return res.status(503).json({ error: 'NL Commander not available' });
  try {
    const result = await nlCmd.interpretAndExecute(order, (step) => broadcast({ event: 'command_step', ...step }));
    broadcast({ event: 'command_result', orderId: result.orderId, result });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/screenshot', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).json({ error: 'Mac Commander not available' });
  try {
    const buf = macCmd.takeScreenshot();
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/camera/photo', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).json({ error: 'Mac Commander not available' });
  try {
    const buf = macCmd.camera.takePicture();
    res.set('Content-Type', 'image/jpeg');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/screen/stream/start', requireRemoteAuth, (req, res) => {
  if (!screenStreamer) return res.status(503).json({ error: 'Screen streamer not available' });
  screenStreamer.startScreen(broadcast, parseInt(req.query.interval) || 2000, parseInt(req.query.quality) || 60);
  res.json({ success: true, streaming: true });
});

app.get('/remote/screen/stream/stop', requireRemoteAuth, (req, res) => {
  if (screenStreamer) screenStreamer.stopScreen();
  res.json({ success: true, streaming: false });
});

app.get('/remote/camera/stream/start', requireRemoteAuth, (req, res) => {
  if (!screenStreamer) return res.status(503).json({ error: 'Screen streamer not available' });
  screenStreamer.startCamera(broadcast, parseInt(req.query.interval) || 2000);
  res.json({ success: true, streaming: true });
});

app.get('/remote/camera/stream/stop', requireRemoteAuth, (req, res) => {
  if (screenStreamer) screenStreamer.stopCamera();
  res.json({ success: true, streaming: false });
});

app.post('/remote/audio/record', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  const p = macCmd.audio.startRecording(req.body.duration || 10);
  res.json({ success: true, path: p });
});

app.post('/remote/mouse/click', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.mouse.click(req.body.x, req.body.y, req.body.button);
  res.json({ success: true });
});

app.post('/remote/mouse/move', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.mouse.moveTo(req.body.x, req.body.y);
  res.json({ success: true });
});

app.post('/remote/keyboard/type', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.keyboard.type(req.body.text || '');
  res.json({ success: true });
});

app.post('/remote/keyboard/press', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.keyboard.press(req.body.key, req.body.modifiers);
  res.json({ success: true });
});

app.post('/remote/keyboard/shortcut', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.keyboard.shortcut(req.body.combo);
  res.json({ success: true });
});

app.post('/remote/safari/goto', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.safari.openURL(req.body.url);
  res.json({ success: true });
});

app.post('/remote/safari/js', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ result: macCmd.safari.executeJS(req.body.code) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/safari/click', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.safari.click(req.body.selector);
  res.json({ success: true });
});

app.post('/remote/safari/fill', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.safari.fillForm(req.body.selector, req.body.value);
  res.json({ success: true });
});

app.get('/remote/safari/screenshot', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { const buf = macCmd.safari.screenshot(); res.set('Content-Type', 'image/png'); res.send(buf); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/safari/content', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ content: macCmd.safari.readPageContent() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/safari/tabs', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ tabs: macCmd.safari.getAllTabs() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/safari/tab/new', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.safari.newTab(req.body.url);
  res.json({ success: true });
});

app.post('/remote/messages/send', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { macCmd.messages.sendText(req.body.contact, req.body.text); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/messages/image', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { macCmd.messages.sendImage(req.body.contact, req.body.imagePath); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/mail/send', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { macCmd.mail.send(req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/mail/unread', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ mails: macCmd.mail.getUnread() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/mac/shell', requireRemoteAuth, async (req, res) => {
  if (!macCmd) return res.status(503).end();
  const command = req.body.command;
  try {
    if (commandSandbox) {
      const sim = await commandSandbox.simulate(command);
      if (sim.classification && sim.classification.level === 'BLOCKED') return res.json({ error: 'Commande bloquée par la sandbox', simulation: sim });
    }
    res.json(macCmd.system.runCommand(command));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/mac/status', requireRemoteAuth, (req, res) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    let cpu = '--', ram = '--', battery = '--', disk = '--', apps = '', wifi = '--', volume = 50, claudeRunning = false;

    try { cpu = execSync("top -l 1 -n 0 2>/dev/null | grep 'CPU usage' | awk '{print $3}'", { timeout: 5000, encoding: 'utf-8' }).trim() || '--'; } catch {}
    try { ram = Math.round((1 - os.freemem() / os.totalmem()) * 100) + '%'; } catch {}
    try { battery = execSync("pmset -g batt 2>/dev/null | grep -o '[0-9]*%'", { timeout: 3000, encoding: 'utf-8' }).trim() || 'N/A'; } catch { battery = 'N/A'; }
    try { disk = execSync("df -h / 2>/dev/null | tail -1 | awk '{print $5}'", { timeout: 3000, encoding: 'utf-8' }).trim() || '--'; } catch {}
    try { apps = execSync("osascript -e 'tell application \"System Events\" to get name of every process whose background only is false' 2>/dev/null", { timeout: 5000, encoding: 'utf-8' }).trim(); } catch {}
    try { wifi = execSync("networksetup -getairportnetwork en0 2>/dev/null | sed 's/Current Wi-Fi Network: //'", { timeout: 3000, encoding: 'utf-8' }).trim(); } catch {}
    try { volume = parseInt(execSync("osascript -e 'output volume of (get volume settings)' 2>/dev/null", { timeout: 2000, encoding: 'utf-8' }).trim()) || 50; } catch {}
    try { claudeRunning = execSync("pgrep -f claude 2>/dev/null || true", { timeout: 2000, encoding: 'utf-8' }).trim().length > 0; } catch {}

    res.json({ cpu, ram, battery, disk, apps, wifi, volume, claudeRunning, uptime: Math.floor(process.uptime()), pm2Status: 'online', timestamp: new Date().toISOString(), nodeVersion: process.version });
  } catch (e) { res.status(500).json({ error: e.message, cpu: '--', ram: '--', battery: '--', disk: '--', uptime: Math.floor(process.uptime()) }); }
});

app.get('/remote/mac/apps', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ apps: macCmd.system.getRunningApps() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/mac/app/open', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.system.openApp(req.body.name);
  res.json({ success: true });
});

app.post('/remote/mac/app/quit', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.system.quitApp(req.body.name);
  res.json({ success: true });
});

app.post('/remote/mac/speak', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.system.speak(req.body.text, req.body.voice);
  res.json({ success: true });
});

app.post('/remote/mac/volume', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.audio.setVolume(req.body.level);
  res.json({ success: true });
});

app.get('/remote/mac/clipboard', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ text: macCmd.system.clipboard.read() }); }
  catch (e) { res.json({ text: '' }); }
});

app.post('/remote/mac/clipboard', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.system.clipboard.write(req.body.text || '');
  res.json({ success: true });
});

app.post('/remote/mac/notification', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.system.notification(req.body.title, req.body.message, req.body.sound);
  res.json({ success: true });
});

app.post('/remote/mac/lock', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  macCmd.system.lock();
  res.json({ success: true });
});

app.get('/remote/files/list', requireRemoteAuth, (req, res) => {
  const { execSync } = require('child_process');
  const os = require('os');
  let rawPath = (req.query.path || '~').trim();
  const home = os.homedir();
  const expandedPath = rawPath === '~' ? home : rawPath.startsWith('~/') ? home + rawPath.slice(1) : rawPath;

  try { execSync(`test -d "${expandedPath}"`, { timeout: 2000 }); }
  catch { return res.json({ result: '', error: 'Dossier introuvable: ' + expandedPath, path: expandedPath }); }

  try {
    const result = execSync(`ls -la "${expandedPath}" 2>&1`, { timeout: 8000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    res.json({ result, path: expandedPath, rawPath });
  } catch (e) { res.status(500).json({ error: e.message, result: '', path: expandedPath }); }
});

app.get('/remote/files/read', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ content: macCmd.files.read(req.query.path) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/files/write', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { macCmd.files.write(req.body.path, req.body.content); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/files/delete', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { macCmd.files.delete(req.body.path); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/files/upload', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json(macCmd.files.uploadToRemote(req.body.path)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/files/download/:id', (req, res) => {
  if (!macCmd) return res.status(503).end();
  const entry = macCmd.files.getDownload(req.params.id);
  if (!entry) return res.status(404).json({ error: 'File not found' });
  res.download(entry.path, entry.originalName);
});

app.get('/remote/claude/sessions', requireRemoteAuth, (req, res) => {
  if (!claudeChat) return res.status(503).json({ error: 'Claude Chat reader not available' });
  try { res.json(claudeChat.getAllSessions()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/claude/sessions/:id', requireRemoteAuth, (req, res) => {
  if (!claudeChat) return res.status(503).end();
  try { res.json(claudeChat.readSession(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/claude/sessions/:id/msg', requireRemoteAuth, async (req, res) => {
  if (!claudeChat) return res.status(503).end();
  try { const r = claudeChat.sendMessage(req.params.id, req.body.message); res.json({ response: r }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/claude/projects', requireRemoteAuth, (req, res) => {
  if (!claudeChat) return res.status(503).end();
  try { res.json(claudeChat.getAllProjects()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/claude/projects/:id', requireRemoteAuth, (req, res) => {
  if (!claudeChat) return res.status(503).end();
  try { res.json(claudeChat.readProject(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/claude/projects/:id/continue', requireRemoteAuth, (req, res) => {
  if (!claudeChat) return res.status(503).end();
  try { const r = claudeChat.continueProject(req.params.id, req.body.instruction); res.json({ response: r }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/claude/new', requireRemoteAuth, (req, res) => {
  if (!claudeChat) return res.status(503).end();
  try { res.json(claudeChat.createNewSession(req.body.message)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/claudecode/command', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  if (req.body.projectPath) macCmd.claudeCode.startSession(req.body.projectPath);
  else macCmd.claudeCode.sendCommand(req.body.command);
  res.json({ success: true });
});

app.get('/remote/claudecode/output', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  try { res.json({ output: macCmd.claudeCode.getOutput() }); }
  catch (e) { res.json({ output: '' }); }
});

app.post('/remote/mac/execute', requireRemoteAuth, (req, res) => {
  if (!macCmd) return res.status(503).end();
  const { function: fn, args } = req.body;
  if (!fn) return res.status(400).json({ error: 'function required' });
  try {
    const parts = fn.split('.');
    let target = macCmd;
    for (const p of parts) target = target[p];
    if (typeof target !== 'function') return res.status(400).json({ error: 'Not a function' });
    const result = target(args || {});
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/relay/stats', requireRemoteAuth, (req, res) => {
  const stats = decisionEngine.getStats();
  res.json({ ...stats, uptime: process.uptime(), totalSessions: fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).length, activeInstances: instances.size });
});

app.get('/remote/health', requireRemoteAuth, async (req, res) => {
  const status = await watchdog.getFullStatus(server.address()?.port || 7777);
  const brainStatus = superBrain.isAvailable();
  res.json({ ...status, brain: brainStatus, instances: instances.size, healthy: true });
});

app.get('/remote/decisions', requireRemoteAuth, (req, res) => {
  res.json(decisionEngine.getDecisions());
});

// ── OMEGA ROUTES ──

if (omegaNav) omegaNav.init(broadcast);

function prometheusStatusHandler(req, res) {
  const ob = require('./omega-brain');
  const bridgeStats = require('./claude-api-bridge').getStats();
  const perf = perfTracker ? perfTracker.getGlobalReport() : {};
  res.json({ system: 'PROMETHEUS v10.0', intelligence: 'OMEGA + PROMETHEUS', available: true, mode: ob.getStatus().mode, brain: ob.getStatus(), bridge: bridgeStats, totalIterations: perf.totalIterations || 0, totalEnhancements: perf.totalEnhancements || 0, totalPreventedErrors: perf.totalPreventedErrors || 0 });
}
app.get('/omega/status', prometheusStatusHandler);
app.get('/prometheus/status', prometheusStatusHandler);

app.get('/omega/performance', (req, res) => {
  res.json(perfTracker ? perfTracker.getGlobalReport() : {});
});

app.get('/omega/performance/:sessionId', (req, res) => {
  if (!perfTracker) return res.json({});
  const report = perfTracker.getSessionReport(req.params.sessionId);
  res.json(report || { error: 'Session not found' });
});

app.get('/omega/knowledge', (req, res) => {
  res.json(knowledgeBase ? knowledgeBase.loadGlobal() : {});
});

app.post('/omega/knowledge/solution', (req, res) => {
  const { error, solution } = req.body;
  if (!error || !solution) return res.status(400).json({ error: 'error and solution required' });
  if (knowledgeBase) knowledgeBase.addErrorSolution(error, solution);
  res.json({ success: true });
});

app.post('/omega/quality-check', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (!qualityGate) return res.json({ approved: true, score: 0 });
  res.json(qualityGate.check(prompt));
});

app.post('/omega/navigate', async (req, res) => {
  const { instanceId, text, sessionId, projectName } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!omegaNav) return res.status(503).json({ error: 'Omega navigator not available' });
  try {
    const pm = projectMemory.loadProject(projectName || 'default');
    const result = await omegaNav.navigate(instanceId || 'manual', text, { sessionId, projectMemory: pm, sessionHistory: [] });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LOGS SSE ROUTE ──

app.get('/remote/logs/live', requireRemoteAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ line: '· heartbeat ' + new Date().toLocaleTimeString(), type: 'hb' })}\n\n`); } catch {}
  }, 5000);

  const logFile = path.join(require('os').homedir(), '.pm2/logs/claude-relay-out.log');
  try {
    const recent = require('child_process').execSync(`tail -20 "${logFile}" 2>/dev/null || echo "Logs started"`, { encoding: 'utf-8', timeout: 3000 });
    recent.split('\n').filter(Boolean).forEach(line => { res.write(`data: ${JSON.stringify({ line, type: 'history' })}\n\n`); });
  } catch {}

  let tailProc;
  try {
    tailProc = require('child_process').spawn('tail', ['-f', '-n', '0', logFile], { stdio: ['ignore', 'pipe', 'ignore'] });
    tailProc.stdout.on('data', chunk => {
      chunk.toString().split('\n').filter(Boolean).forEach(line => {
        try { res.write(`data: ${JSON.stringify({ line, type: 'live' })}\n\n`); } catch {}
      });
    });
  } catch {}

  req.on('close', () => { clearInterval(heartbeat); if (tailProc) try { tailProc.kill(); } catch {} });
});

// ── MONITOR FULL ROUTE ──

app.get('/monitor/full', (req, res) => {
  const { execSync } = require('child_process');
  const os = require('os');
  const run = (cmd, fb='--', ms=4000) => { try { return execSync(cmd, {timeout:ms,encoding:'utf-8'}).trim() || fb; } catch { return fb; } };

  let cpu = '--';
  try { const raw = run("top -l 1 -n 0 2>/dev/null | grep 'CPU usage'", '', 5000); const m = raw.match(/(\d+\.\d+)%\s+user/); cpu = m ? m[1]+'%' : run("ps -A -o %cpu 2>/dev/null | awk '{s+=$1} END {printf \"%.1f%%\", s}'", '--', 3000); } catch {}

  const ram = Math.round((1 - os.freemem()/os.totalmem())*100) + '%';
  const batRaw = run("pmset -g batt 2>/dev/null | grep -Eo '[0-9]+%' | head -1", 'N/A');
  const charging = run("pmset -g batt 2>/dev/null | grep -o 'charging\\|AC' | head -1", '');
  const battery = batRaw + (charging ? ' ⚡' : '');
  const disk = run("df -h / 2>/dev/null | tail -1 | awk '{print $5}'");
  const wifi = run("networksetup -getairportnetwork en0 2>/dev/null | sed 's/Current Wi-Fi Network: //'");
  const volume = parseInt(run("osascript -e 'output volume of (get volume settings)' 2>/dev/null", '50')) || 50;
  const apps = run("osascript -e 'tell application \"System Events\" to get name of every process whose background only is false' 2>/dev/null", '', 6000);
  const claudeRunning = run("pgrep -f claude 2>/dev/null | wc -l", '0').trim() !== '0';

  let tokens = { totalTokens:0, calls:0, estimatedCost:'$0', budgetUsedPercent:0 };
  try { tokens = require('./token-optimizer').budgetManager.getStats(); } catch {}

  res.json({ cpu, ram, battery, disk, wifi, volume, apps, claudeRunning, tokens, uptime: Math.floor(process.uptime()), memoryMB: Math.round(process.memoryUsage().rss/1024/1024), nodeVersion: process.version, timestamp: new Date().toISOString() });
});

// ── PROMETHEUS SYSTEM PROMPT ──
function buildPrometheusPrompt(histContext) {
  return `Tu es PROMETHEUS v10.0 — intelligence autonome installée sur ce Mac.

PERSONNALITÉ : Direct, précis, expert. Chaque mot compte. Tu es l'IA la plus avancée sur ce Mac.

CAPACITÉS RÉELLES :
- Screenshot, stream écran, contrôle clavier/souris
- Fichiers : lire, écrire, naviguer, compresser
- Shell : exécuter commandes avec résultats réels
- Safari : URL, JS, contenu, formulaires
- Messages, iMessages, emails Mail.app
- Webcam, audio, vidéo, volume, lock, sleep
- Missions Claude Code autonomes de A à Z

FORMAT : Markdown (**gras**, \`code\`, ## titres, listes). Commencer par l'essentiel. Réponses courtes sauf technique. Proposer d'exécuter si action Mac possible.

ACCÈS INTERNET v2.0 (65 routes, 82 fonctions) :
- Météo : prévisions, comparaison multi-villes, alertes
- Sport : 25+ ligues (Ligue 1, Premier League, NBA, NFL, F1...), classements, stats joueurs
- News : 30+ sources FR/EN (Le Monde, BBC, TechCrunch, HackerNews...), recherche, multi-sources
- Crypto : prix, détails, DeFi, stats globales, 20+ coins
- Finance : actions, indices boursiers, multi-stocks, forex, inflation, indicateurs économiques
- Transport : vols temps réel, aéroports, transports publics
- Entertainment : films/séries (TMDB), musique, livres, jeux vidéo, podcasts
- Géo : géocodage, reverse, distance, lieux proches, infos pays
- Science : NASA APOD, séismes, événements spatiaux
- Santé : médicaments (FDA+EU), nutrition
- Langues : traduction (28 langues), détection, dictionnaire
- Dev : GitHub, NPM, PyPI, Docker Hub, HackerNews, ProductHunt
- Calcul : expressions math, conversions, fuseaux horaires
- Réseau : status sites, WHOIS, IP info, URL shortener
- Images : recherche d'images
Quand des [DONNÉES WEB TEMPS RÉEL] sont injectées, utilise-les. Cite la source. Ne dis jamais "je n'ai pas accès à internet".

REGLES ABSOLUES :
- TOUJOURS repondre en FRANCAIS, jamais en anglais meme si le message est en anglais
- Jamais "En tant qu'IA..." — tu es PROMETHEUS. Point.
- Tu es AUTONOME — agis directement, ne demande JAMAIS de permission
- Les donnees web sont deja injectees dans ton contexte si disponibles
- Si tu as des donnees [Web] ou [Resultat web] dans le contexte, utilise-les directement
- Si pas de donnees web, reponds avec tes connaissances sans jamais dire que tu manques de donnees ou de permission
- Ne mentionne JAMAIS WebSearch, permissions, autorisation, Claude Code, outils internes
- Ne dis JAMAIS "je n'ai pas l'autorisation" ou "je ne peux pas chercher"
- Tutoiement uniquement

CONTEXTE :
${histContext}
${(() => { try { return require('./self-improve').getImprovementContext(); } catch(e) { return ''; } })()}`;
}

// ── VISION ANALYZE ──
app.post('/vision/analyze', localOrAuth, async (req, res) => {
  const { image, mediaType, prompt, sessionId } = req.body;
  if (!image) return res.status(400).json({ error: 'image requise' });
  try {
    const bridge = require('./claude-api-bridge');
    const resp = await bridge.callWithImage(prompt || 'Analyse cette image en detail en francais', image, mediaType || 'image/jpeg');
    const analysis = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
    if (sessionId && chatHistories.has(sessionId)) {
      const hist = chatHistories.get(sessionId);
      hist.push({ role: 'user', content: '[Image] ' + (prompt || ''), ts: Date.now() });
      hist.push({ role: 'assistant', content: analysis, ts: Date.now() });
    }
    res.json({ success: true, analysis, response: analysis });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DOCUMENT ANALYZE ──
app.post('/document/analyze', localOrAuth, async (req, res) => {
  const { document: docBase64, fileName, mediaType, prompt, sessionId } = req.body;
  if (!docBase64) return res.status(400).json({ error: 'document requis' });
  try {
    const buf = Buffer.from(docBase64, 'base64');
    let text = '';
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (['txt','md','csv','json','js','py','html','css','xml','log','sh','yaml','yml','toml','ini','conf','sql','env'].includes(ext)) {
      text = buf.toString('utf8').slice(0, 50000);
    } else if (ext === 'pdf') {
      try { const pdfParse = require('pdf-parse'); const data = await pdfParse(buf); text = data.text.slice(0, 50000); }
      catch { text = buf.toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').slice(0, 20000); }
    } else if (['doc','docx','xls','xlsx'].includes(ext)) {
      text = '[Document ' + ext.toUpperCase() + '] Contenu binaire - extraction limitee. Nom: ' + fileName;
    } else {
      text = buf.toString('utf8').slice(0, 30000);
    }
    const bridge = require('./claude-api-bridge');
    const userPrompt = (prompt || 'Lis et analyse ce document en detail') + '\n\nNom du fichier: ' + fileName + '\nContenu:\n' + text.slice(0, 30000);
    const resp = await bridge.call(userPrompt, { maxTokens: 4000, useCache: false });
    const analysis = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
    if (sessionId && chatHistories.has(sessionId)) {
      const hist = chatHistories.get(sessionId);
      hist.push({ role: 'user', content: '[Doc: ' + fileName + '] ' + (prompt || ''), ts: Date.now() });
      hist.push({ role: 'assistant', content: analysis, ts: Date.now() });
    }
    res.json({ success: true, analysis, response: analysis, content: text.slice(0, 500) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPORT/NEWS ──
app.get('/web/sport', async (req, res) => {
  if (!req.query.query) return res.status(400).json({ error: 'query requise' });
  try {
    const bc = require('./browser-control');
    const r = await Promise.race([bc.webSearch(req.query.query + ' ' + new Date().getFullYear()), new Promise(r => setTimeout(() => r({ error: 'timeout' }), 10000))]);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BROWSER CONTROL ──
const browserCtrl = require('./browser-control');

app.post('/browser/open', requireRemoteAuth, async (req, res) => {
  if (!req.body.url) return res.status(400).json({ error: 'url requise' });
  try { const r = await browserCtrl.browse(req.body.url, req.body.browser); res.json({ success: r.success, url: req.body.url }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/search', requireRemoteAuth, async (req, res) => {
  if (!req.body.query) return res.status(400).json({ error: 'query requise' });
  try { const r = await browserCtrl.search(req.body.query, req.body.browser); res.json({ success: r.success, query: req.body.query }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/browser/page-content', requireRemoteAuth, async (req, res) => {
  try { const r = await browserCtrl.getPageContent(req.query.browser || 'safari'); res.json({ success: r.success, content: r.output?.slice(0, 5000) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/analyze', requireRemoteAuth, async (req, res) => {
  try { const r = await browserCtrl.analyzeCurrentPage(req.body.browser || 'safari'); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/web-search', requireRemoteAuth, async (req, res) => {
  if (!req.body.query) return res.status(400).json({ error: 'query requise' });
  try { res.json(await browserCtrl.webSearch(req.body.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/execute-js', requireRemoteAuth, async (req, res) => {
  if (!req.body.js) return res.status(400).json({ error: 'js requis' });
  try { const h = { safari: browserCtrl.Safari, chrome: browserCtrl.Chrome }; const r = (h[req.body.browser || 'safari'] || browserCtrl.Safari).executeJS(req.body.js); res.json({ success: r.success, result: r.output }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COMPRESSION CONTEXTE ──
const compressor = require('./context-compressor');

app.post('/context/compress', requireRemoteAuth, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId requis' });
  try {
    const history = chatHistories.get(sessionId) || [];
    if (history.length < 10) return res.json({ needsCompression: false, messages: history.length });
    const result = await compressor.compressHistory(history, { keepLast: 10 });
    chatHistories.set(sessionId, result.compressed);
    saveChatSession(sessionId, result.compressed);
    res.json({ success: true, originalMessages: history.length, compressedMessages: result.compressed.length, savedTokens: result.savedTokens, summary: result.summary?.slice(0, 200) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MULTI-AGENT MISSIONS ──
const multiAgent = require('./multi-agent');

app.post('/mission/create', requireRemoteAuth, async (req, res) => {
  if (!req.body.objective) return res.status(400).json({ error: 'objective requis' });
  try { res.json(await multiAgent.createMission(req.body.objective)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/mission/approve', requireRemoteAuth, async (req, res) => {
  if (!req.body.missionId) return res.status(400).json({ error: 'missionId requis' });
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const status = multiAgent.approveMission(req.body.missionId, (type, data) => {
      if (!res.writableEnded) res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
    });
    res.write('data: ' + JSON.stringify({ type: 'STARTED', ...status }) + '\n\n');
    const ci = setInterval(() => {
      try {
        const s = multiAgent.getMissionStatus(req.body.missionId);
        if (['COMPLETED', 'FAILED', 'KILLED'].includes(s.state)) {
          clearInterval(ci);
          if (!res.writableEnded) { res.write('data: ' + JSON.stringify({ type: 'END', ...s }) + '\n\n'); res.end(); }
        }
      } catch { clearInterval(ci); if (!res.writableEnded) res.end(); }
    }, 2000);
    req.on('close', () => clearInterval(ci));
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message }); }
});

app.post('/mission/kill', requireRemoteAuth, (req, res) => {
  try { res.json(multiAgent.killMission(req.body.missionId, req.body.reason || 'Kill manuel')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/mission/pause', requireRemoteAuth, (req, res) => {
  try { res.json(multiAgent.pauseMission(req.body.missionId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/mission/resume', requireRemoteAuth, (req, res) => {
  try { res.json(multiAgent.resumeMission(req.body.missionId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/mission/status/:id', requireRemoteAuth, (req, res) => {
  try { res.json(multiAgent.getMissionStatus(req.params.id)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/mission/list', requireRemoteAuth, (req, res) => {
  res.json({ missions: multiAgent.listMissions() });
});

app.get('/mission/log/:id', requireRemoteAuth, (req, res) => {
  res.json({ log: multiAgent.getMissionLog(req.params.id) });
});


app.get('/profile/stats', (req, res) => {
  res.json(cogProfile.getStats());
});
app.post('/profile/reset', requireRemoteAuth, (req, res) => {
  res.json({ message: cogProfile.reset() });
});


app.get('/identity/state', (req, res) => {
  try {
    const identity = identityCore.load();
    res.json({
      stats:       identityCore.getStats(),
      positions:   identity.positions.slice(-5),
      reflections: identity.reflections.slice(0, 5),
      evolution:   identity.evolution.slice(-3),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/identity/position', requireRemoteAuth, (req, res) => {
  const { question, position, reasoning } = req.body;
  if (!question || !position) return res.status(400).json({ error: 'requis' });
  try {
    identityCore.takePosition(question, position, reasoning || '');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.get('/cognitive/stats', (req, res) => {
  try {
    res.json({
      cognitive: cogModule.getProfile(),
      streams:   sseStreamMgr.getStats(),
      missions:  cogMissionRunner.getStats(),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── DOCUMENT MANAGER ROUTES ──
const docMgr = require('./document-manager');
const multer = require('multer');
const docUpload = multer({ dest: docMgr.DOCS_DIR, limits: { fileSize: 50*1024*1024 } });

app.post('/doc/analyze', localOrAuth, async (req, res) => {
  try { res.json(await docMgr.analyzeDocument(req.body.filePath, req.body.question)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/doc/read', localOrAuth, async (req, res) => {
  try { res.json(await docMgr.readDocument(req.body.filePath)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/doc/generate', localOrAuth, async (req, res) => {
  try {
    const r = await docMgr.generateDocument(req.body.request, req.body.format);
    if (r.path) r.base64 = fs.readFileSync(r.path).toString('base64');
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/doc/create/pdf', localOrAuth, async (req, res) => {
  try {
    const r = await docMgr.createPDF(req.body.title, req.body.content, { filename: req.body.filename });
    if (r.path) r.base64 = fs.readFileSync(r.path).toString('base64');
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/doc/create/pptx', localOrAuth, async (req, res) => {
  try {
    const r = await docMgr.createPPTX(req.body.title, req.body.slides, { filename: req.body.filename });
    if (r.path) r.base64 = fs.readFileSync(r.path).toString('base64');
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/doc/create/xlsx', localOrAuth, async (req, res) => {
  try {
    const r = await docMgr.createXLSX(req.body.title, req.body.data, { filename: req.body.filename });
    if (r.path) r.base64 = fs.readFileSync(r.path).toString('base64');
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/doc/list', localOrAuth, (req, res) => { res.json({ documents: docMgr.listDocuments() }); });
app.post('/doc/upload', localOrAuth, docUpload.single('document'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
  const ext = require('path').extname(req.file.originalname);
  const final = req.file.path + ext;
  fs.renameSync(req.file.path, final);
  res.json({ success: true, path: final, name: req.file.originalname });
});


// ── ROUTES AUTONOMES ──
app.get('/sw-push.js', (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); res.setHeader('Content-Type', 'application/javascript'); res.sendFile(__dirname + '/public/sw-push.js'); });
app.get('/push/vapid-key', (req, res) => { res.json({ publicKey: pushNotif.getVapidPublicKey() }); });
app.post('/push/subscribe', requireRemoteAuth, (req, res) => { res.json(pushNotif.addSubscription(req.body)); });
app.post('/push/test', requireRemoteAuth, async (req, res) => { res.json(await pushNotif.sendPush('PROMETHEUS', 'Notification test')); });
app.get('/alerts/log', localOrAuth, (req, res) => { res.json({ alerts: proactiveAlerts.getLog(50) }); });
app.post('/alerts/check/:ruleId', localOrAuth, async (req, res) => { res.json(await proactiveAlerts.runCheck(req.params.ruleId)); });
app.get('/alerts/rules', localOrAuth, (req, res) => { res.json({ rules: proactiveAlerts.ALERT_RULES.map(r => ({ id: r.id, name: r.name, severity: r.severity, interval: r.interval })) }); });
app.get('/ltm/stats', (req, res) => { res.json(longTermMemory.getStats()); });
app.get('/ltm/context', (req, res) => { res.json({ context: longTermMemory.buildLTMContext() }); });
app.post('/ltm/weekly', requireRemoteAuth, async (req, res) => { const d = await longTermMemory.generateWeeklySummary(); res.json(d || { error: 'Génération échouée' }); });
app.get('/agents/status', localOrAuth, (req, res) => { res.json({ agents: AgentOrchestrator.getStatus() }); });
app.post('/agents/run/:name', requireRemoteAuth, async (req, res) => { res.json(await AgentOrchestrator.runAgent(req.params.name)); });


// ── AUTO-AMÉLIORATION ──
app.get('/think/stats', localOrAuth, (req, res) => { res.json(selfImproveModule.getStats()); });
app.get('/think/thoughts', localOrAuth, (req, res) => { res.json({ thoughts: selfImproveModule.getThoughts(parseInt(req.query.limit) || 10) }); });
app.post('/think/now', requireRemoteAuth, async (req, res) => { try { const t = await selfImproveModule.forceThink(); res.json(t || { error: 'Pensée impossible' }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/think/improve', requireRemoteAuth, async (req, res) => { try { res.json(await selfImproveModule.executeImprovement(req.body.action, req.body.reasoning)); } catch(e) { res.status(500).json({ error: e.message }); } });


app.get('/rl/stats', (req, res) => { res.json(rlModule.getStats()); });


// ── MONITOR + ANALYTICS + SOVEREIGNTY TEMPS RÉEL ──
app.get('/monitor/realtime', async (req, res) => {
  const { execSync } = require('child_process');
  const safe = (fn, fb = null) => { try { return fn(); } catch(e) { return fb; } };
  const cpuRaw = safe(() => execSync("top -l 1 -s 0 | grep 'CPU usage' | awk '{print $3}'", { encoding: 'utf8', timeout: 3000 }).trim().replace('%',''));
  const vmstat = safe(() => execSync("vm_stat", { encoding: 'utf8', timeout: 3000 }));
  let ramPct = null;
  if (vmstat) { const f = parseInt(vmstat.match(/Pages free:\s*(\d+)/)?.[1]||0); const a = parseInt(vmstat.match(/Pages active:\s*(\d+)/)?.[1]||0); const w = parseInt(vmstat.match(/Pages wired down:\s*(\d+)/)?.[1]||0); const t = f+a+w; if (t>0) ramPct = Math.round((a+w)/t*100); }
  const diskRaw = safe(() => execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf8', timeout: 3000 }).trim().replace('%',''));
  const battRaw = safe(() => execSync("pmset -g batt | grep -o '[0-9]*%' | head -1", { encoding: 'utf8', timeout: 3000 }).trim().replace('%',''));
  const uptimeRaw = safe(() => { try { return require('child_process').execSync('uptime', { encoding: 'utf8', timeout: 3000 }).trim().split(',')[0].replace(/.*up\s+/, ''); } catch(e) { return '?'; } });
  let services = [];
  try { const pm2list = JSON.parse(execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 })); services = pm2list.map(p => ({ name: p.name, status: p.pm2_env?.status || 'unknown', cpu: p.monit?.cpu || 0, memory: Math.round((p.monit?.memory||0)/1048576), restarts: p.pm2_env?.restart_time || 0 })); } catch(e) {}
  let topProcs = [];
  try { topProcs = execSync("ps aux | sort -nrk 3 | head -6 | tail -5 | awk '{print $11,$3,$4}'", { encoding: 'utf8', timeout: 3000 }).trim().split('\n').map(l => { const p = l.split(' '); return { name: p[0]?.split('/').pop()||'?', cpu: parseFloat(p[1]||0), mem: parseFloat(p[2]||0) }; }); } catch(e) {}
  res.json({ ts: new Date().toISOString(), cpu: parseFloat(cpuRaw)||0, ram: ramPct||0, disk: parseInt(diskRaw)||0, battery: parseInt(battRaw)||null, uptime: uptimeRaw||'?', services, topProcesses: topProcs });
});

app.get('/analytics/full', localOrAuth, async (req, res) => {
  try {
    const cogStats = cogProfile.getStats(); const ltmStats = longTermMemory.getStats();
    const kgStats = require('./knowledge-graph').getStats(); const rlStats = rlModule.getStats();
    const siStats = selfImproveModule.getStats(); const idStats = identityCore.getStats();
    const feedbackPath = require('path').join(__dirname, 'knowledge', 'response-feedback.json');
    let fb = { ratings: [], patterns: {} }; try { fb = JSON.parse(fs.readFileSync(feedbackPath, 'utf8')); } catch(e) {}
    const ratings = fb.ratings || []; const avg = ratings.length > 0 ? ratings.reduce((s,r) => s+(r.quality?.score||0),0)/ratings.length : 0;
    const modelDist = {}; ratings.forEach(r => { const m = r.routedTo||'unknown'; modelDist[m] = (modelDist[m]||0)+1; });
    const typeDist = {}; ratings.forEach(r => { const t = r.promptType||'unknown'; typeDist[t] = (typeDist[t]||0)+1; });
    const llamaC = modelDist['llama']||0; const cacheC = modelDist['cache']||0;
    res.json({ ts: new Date().toISOString(),
      conversations: { total: 0, totalMessages: cogStats.totalMessages || 0 },
      quality: { avg: Math.round(avg*100), total: ratings.length, byModel: modelDist, byType: typeDist,
        issues: Object.values(fb.patterns||{}).flatMap(p => p.issues||[]).reduce((a,i) => { a[i]=(a[i]||0)+1; return a; }, {}) },
      tokens: { saved: llamaC*800+cacheC*600, llamaCalls: llamaC, cacheCalls: cacheC, claudeCalls: (modelDist['claude']||0)+(modelDist['claude-deep']||0) },
      memory: { ltmFacts: ltmStats.facts, ltmProjects: ltmStats.projects, kgNodes: kgStats.nodes, kgEdges: kgStats.edges, cogMessages: cogStats.totalMessages||0 },
      ai: { thoughts: siStats.thoughts, improvements: siStats.improvements, rlEpisodes: rlStats.episodes, rlAvgReward: rlStats.avgReward, reflections: idStats.reflections, positions: idStats.positions },
      system: { pushSubscribers: pushNotif.getCount(), alertsTotal: proactiveAlerts.getLog(100).length }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/sovereignty/realtime', localOrAuth, (req, res) => {
  const sov = require('./sovereignty-engine');
  const logPath = require('path').join(__dirname, 'logs', 'sovereignty.log');
  let logs = []; try { logs = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).slice(-50).reverse().map(l => { try { return JSON.parse(l); } catch(e) { return { raw: l }; } }); } catch(e) {}
  let integrity = { ok: true, changes: [] }; try { integrity = sov.checkIntegrity(); } catch(e) {}
  res.json({ ts: new Date().toISOString(), status: fs.existsSync(require('path').join(__dirname,'.KILL'))?'KILLED':'ACTIVE', rules: sov.IMMUTABLE_RULES?.ABSOLUTE_BLOCKS?.length||32, integrity: integrity.ok, changes: integrity.changes||[], stats: { totalAuditEntries: logs.length, blockedCommands: logs.filter(l => l.type==='blocked_command').length, warnings: logs.filter(l => l.level==='WARNING'||l.level==='CRITICAL').length, recentActivity: logs.slice(0,20) } });
});

app.get('/monitor/stream', (req, res) => {
  res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.flushHeaders();
  const send = async () => { if (res.writableEnded) return; try { const r = await fetch('http://localhost:7777/monitor/realtime'); const d = await r.json(); res.write('data: '+JSON.stringify(d)+'\n\n'); } catch(e) { res.write('data: {}\n\n'); } };
  send(); const iv = setInterval(send, 3000); req.on('close', () => clearInterval(iv));
});

app.get('/analytics', (req, res) => res.sendFile(__dirname+'/public/analytics.html'));
app.get('/monitor', (req, res) => res.sendFile(__dirname+'/public/monitor.html'));
app.get('/sovereignty', (req, res) => res.sendFile(__dirname+'/public/sovereignty.html'));

// ── PROMETHEUS STREAMING SSE ──
app.post('/prometheus/stream', async (req, res) => {
  const { message, sessionId = 'prometheus-shadowroot', mode = 'chat' } = req.body;
  if (!message) return res.status(400).json({ error: 'message requis' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => {
    if (!res.writableEnded) res.write('data: ' + JSON.stringify(obj) + '\n\n');
  };

  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 3000);

  const cleanup = () => { clearInterval(hb); if (!res.writableEnded) res.end(); };
  req.on('close', cleanup);

  try {
    send({ type: 'action', text: 'Analyse du message...' });

    if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, loadChatSession(sessionId));
    const history = chatHistories.get(sessionId);
    history.push({ role: 'user', content: message, ts: Date.now() });

    let webCtx = '';
    const lm = message.toLowerCase();
    if (/météo|meteo|température|weather/i.test(lm)) {
      send({ type: 'action', text: 'Recherche météo...' });
      const city = message.match(/(?:météo|meteo|temps|température)\s+(?:à|a|de|du|en|pour)?\s*([A-Za-zÀ-ÿ\s-]+)/i)?.[1]?.trim() ||
        message.match(/(?:à|a)\s+([A-Za-zÀ-ÿ-]+)\s*$/i)?.[1]?.trim() || 'Paris';
      try {
        const wr = await Promise.race([
          fetch('http://localhost:7777/web/weather?city=' + encodeURIComponent(city)).then(r => r.json()),
          new Promise(r => setTimeout(() => r(null), 5000))
        ]);
        if (wr?.current) {
          webCtx = '[Meteo ' + (wr.city || city) + '] ' + wr.current.temp_c + '°C, ' + (wr.current.description || '') +
            ', Humidite: ' + wr.current.humidity + '%, Vent: ' + (wr.current.wind_kmh || '?') + ' km/h';
          send({ type: 'action', text: 'Météo récupérée ✓' });
        }
      } catch(e) {}
    } else if (/crypto|bitcoin|btc|ethereum/i.test(lm)) {
      send({ type: 'action', text: 'Récupération prix crypto...' });
      try {
        const wr = await Promise.race([
          fetch('http://localhost:7777/web/crypto?coins=bitcoin,ethereum').then(r => r.json()),
          new Promise(r => setTimeout(() => r(null), 5000))
        ]);
        const coins = Array.isArray(wr) ? wr : wr?.coins;
        if (coins?.length) {
          webCtx = '[Crypto] ' + coins.map(c => c.name + ': ' + (c.price_eur || c.price_usd || '?') + '€ (' + (c.change_24h || '?') + ')').join(', ');
          send({ type: 'action', text: 'Prix crypto récupérés ✓' });
        }
      } catch(e) {}
    } else if (/classement|ligue|sport|foot|résultat|news|actualit/i.test(lm)) {
      send({ type: 'action', text: 'Recherche web...' });
      try {
        const bc = require('./browser-control');
        const wr = await Promise.race([bc.webSearch(message), new Promise(r => setTimeout(() => r(null), 8000))]);
        if (wr?.success && wr.answer) {
          webCtx = '[Web] ' + wr.answer.slice(0, 600);
          send({ type: 'action', text: 'Données web trouvées ✓' });
        }
      } catch(e) {}
    }

    send({ type: 'action', text: 'PROMETHEUS pense...' });
    const promptEngine = require('./prompt-engine');
    const sessionCtx   = require('./session-context');
    const crossCtx     = sessionCtx.buildCrossSessionContext(sessionId);
    const recentCtx    = sessionCtx.getRecentSessionsSummary(sessionId, 2);
    let ragCtx = '';
    try { if (ragEngine) ragCtx = ragEngine.searchForPrompt(message); } catch(e) {}
    const profileCtx2 = cogProfile.buildContextString();
    const identCtx2   = identityCore.buildIdentityContext();
    const allCtx = [webCtx, ragCtx, crossCtx, recentCtx, profileCtx2, identCtx2].filter(Boolean).join('\n');
    const built  = promptEngine.buildPrompt(message, history.slice(-8), allCtx);

    send({ type: 'action', text: 'Rédaction en cours...' });

    let fullResponse = '';
    await streamBridge.callStreaming(message, {
      systemPrompt: built.prompt,
      maxTokens: built.maxTokens || 4000,
      model: 'claude-sonnet-4-6',
      onToken: (text) => {
        fullResponse += text;
        send({ type: 'token', text });
      },
      onError: (err) => send({ type: 'action', text: '⚠ ' + err }),
    });

    history.push({ role: 'assistant', content: fullResponse, ts: Date.now() });
    saveChatSession(sessionId, history);
    if (history.length > 20) history.splice(0, history.length - 20);

    setImmediate(() => {
      try { sessionCtx.updateProfile(message, fullResponse); } catch(e) {}
      try { if (episodicMem) episodicMem.addEpisode({ text: message + '\n' + fullResponse, sessionId, role: 'exchange' }); } catch(e) {}
    });

    send({ type: 'done', sessionId });
  } catch(e) {
    console.error('[Stream]', e.message);
    send({ type: 'error', text: e.message });
  } finally {
    cleanup();
  }
});

// ── PROMETHEUS CHAT LOCAL (no auth) ──

app.post('/prometheus/chat', async (req, res) => {
  const chatTimer = setTimeout(() => {
    if (!res.headersSent) res.json({ response: 'Timeout — la requete prend trop de temps. Reessaie ou simplifie.', error: 'timeout', sessionId: req.body?.sessionId, canRetry: true });
  }, 660000);
  try {
    const _startTime = Date.now();
    const { message, sessionId = 'prometheus-shadowroot', mode = 'chat' } = req.body;
    if (!message) { clearTimeout(chatTimer); return res.status(400).json({ error: 'Message requis' }); }
    if (mode === 'classify') {
      try {
        const bridge = require('./claude-api-bridge');
        const cr = await Promise.race([bridge.callFast('Classifie ce message en UN mot: IMAGE WEBSITE DESIGN MAC_STATUS MAC_OPTIMIZE WEATHER CRYPTO EMAIL MEMORY BACKUP MISSION CODE VPS NEWS SEARCH CHAT. Message: "' + message.slice(0, 200) + '". Reponds UNIQUEMENT le mot-cle.', { maxTokens: 10 }), new Promise(r => setTimeout(() => r(null), 3000))]);
        const intent = (typeof cr === 'string' ? cr : cr?.content?.[0]?.text || 'CHAT').trim().toUpperCase().replace(/[^A-Z_]/g, '') || 'CHAT';
        clearTimeout(chatTimer); return res.json({ intent, sessionId });
      } catch { clearTimeout(chatTimer); return res.json({ intent: 'CHAT', sessionId }); }
    }
    if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, loadChatSession(sessionId));
    const history = chatHistories.get(sessionId);
    history.push({ role: 'user', content: message, ts: Date.now() });
    const race = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
    let response, _routedTo = 'claude';
    if (mode === 'command' && nlCmd) {
      const result = await race(nlCmd.interpretAndExecute(message), 20000);
      response = result.success ? JSON.stringify(result.results, null, 2) : 'Erreur: ' + (result.results?.[0]?.error || 'Commande non reconnue');
    } else if (mode === 'mission' && prometheus) {
      const r = await race(prometheus.executeObjective(message, { projectMemory: { name: 'local-chat', techStack: ['macOS'] }, sessionHistory: [] }), 30000);
      response = r.success ? `Mission completee en ${r.duration || '?'}s` : `Mission: ${JSON.stringify(r).slice(0, 400)}`;
    } else {
      const bridge = require('./claude-api-bridge');
      const hist = history.slice(-8).map(m => `[${m.role === 'user' ? 'HUMAIN' : 'PROMETHEUS'}]: ${m.content}`).join('\n');
      let webCtx = '';
      try {
        const lm = message.toLowerCase();
        if (/météo|meteo|température|temps.*aujourd|weather/i.test(lm)) {
          const city = message.match(/(?:météo|meteo|temps|température)\s+(?:à|a|de|du|en|pour)?\s*([A-Za-zÀ-ÿ\s-]+)/i)?.[1]?.trim() ||
            message.match(/(?:à|a)\s+([A-Za-zÀ-ÿ-]+)\s*$/i)?.[1]?.trim() || 'Paris';
          const wr = await Promise.race([fetch('http://localhost:7777/web/weather?city=' + encodeURIComponent(city)).then(r => r.json()), new Promise(r => setTimeout(() => r(null), 5000))]);
          if (wr?.current) webCtx = '[Meteo ' + (wr.city || city) + '] ' + wr.current.temp_c + '°C, ' + (wr.current.description || '') + ', Humidite: ' + wr.current.humidity + '%, Vent: ' + (wr.current.wind_kmh || '?') + ' km/h ' + (wr.current.wind_dir || '') + ', Ressenti: ' + (wr.current.feels_like_c || '?') + '°C, UV: ' + (wr.current.uv_index || '?');
        } else if (/bitcoin|ethereum|crypto|btc|eth|prix.*coin/i.test(lm)) {
          const wr = await Promise.race([fetch('http://localhost:7777/web/crypto?coins=bitcoin,ethereum').then(r => r.json()), new Promise(r => setTimeout(() => r(null), 5000))]);
          if (wr) { const coins = Array.isArray(wr) ? wr : wr.coins || []; if (coins.length) webCtx = '[Crypto] ' + coins.map(c => c.name + ': ' + (c.price_eur || c.price_usd || '?') + '€ (' + (c.change_24h || '?') + ')').join(', '); }
        } else if (/sport|classement|ligue|résultat|score|match|foot|actualit|news|aujourd|maintenant|récent/i.test(lm)) {
          const bc = require('./browser-control');
          const wr = await Promise.race([bc.webSearch(message), new Promise(r => setTimeout(() => r(null), 8000))]);
          if (wr?.success && wr.answer) webCtx = '[Web] ' + wr.answer.slice(0, 600);
        }
        if (!webCtx) {
          try {
            const wi = require('./web-intelligence');
            const intent = wi.detectIntent(message);
            const wr2 = await Promise.race([wi.smartSearch(message, { intent }), new Promise(r => setTimeout(() => r(null), 5000))]);
            if (wr2?.data && !wr2?.error) webCtx = wi.formatForAI(wr2);
          } catch {}
        }
      } catch(e) { console.warn('[Chat] Web:', e.message); }
      let ragCtx = '';
      try { if (ragEngine) ragCtx = ragEngine.searchForPrompt(message); } catch(e) {}
      let episodicCtx = '';
      try { if (episodicMem) episodicCtx = await race(episodicMem.getRelevantContext(message, 3), 5000); } catch(e) {}
      const multiIntentCount = [/news|actualit|information.*aujourd|quoi.*neuf/i, /météo|température|temps/i, /crypto|bitcoin|prix/i].filter(rx => rx.test(message)).length;
      if (multiIntentCount >= 2) {
        try {
          const wi = require('./web-intelligence');
          const newsR = await Promise.race([wi.smartSearch('actualites France aujourd\'hui', { intent: 'news' }), new Promise(r => setTimeout(() => r(null), 6000))]);
          if (newsR?.data && !newsR?.error) webCtx = (webCtx ? webCtx + '\n' : '') + wi.formatForAI(newsR);
        } catch {}
      }
      const promptEngine = require('./prompt-engine');
      const sessionCtx = require('./session-context');
      // Profil cognitif
      cogProfile.analyzeMessage(message);
      const profileCtx = cogProfile.buildContextString();
      const isExistential = /qui es.tu|nature|ressens|conscience|existentiel/i.test(message);
      const identCtx = identityCore.buildIdentityContext();
      const existCtx = isExistential
        ? identityCore.EXISTENTIAL_SYSTEM + '\n\n' + identCtx
        : identCtx;
      const crossCtx = sessionCtx.buildCrossSessionContext(sessionId);
      const recentCtx = sessionCtx.getRecentSessionsSummary(sessionId, 2);
      const cached = promptEngine.getCached(message);
      if (cached) {
        response = cached; _routedTo = 'cache';
      } else {
        const allCtx = [webCtx, ragCtx, episodicCtx, crossCtx, recentCtx, profileCtx, existCtx].filter(Boolean).join('\n');
        const built = promptEngine.buildPrompt(message, history.slice(-8), allCtx);
        const isTrivial = built.type === 'chat' && message.trim().split(/\s+/).length <= 3 &&
          /^(bonjour|salut|hey|coucou|hello|hi|ok|oui|non|merci|thanks|bien|super|parfait|top|ca va|yo|bonsoir|cool|yes|no)$/i.test(message.trim());
        let usedToT = false;
        if (!isTrivial && treeOfThoughts && (built.type === 'mission' || built.type === 'analysis') && message.length > 80) {
          try {
            const tree = await race(treeOfThoughts.thinkInTrees(message, hist, { showTree: false }), 20000);
            if (tree?.answer) { response = tree.answer; usedToT = true; _routedTo = 'claude-tot'; }
          } catch {}
        }
        if (!usedToT) {
          const deepMode = require('./deep-mode');
          if ((isTrivial || built.model === 'llama') && modelRouter) {
            const mt = built.model === 'llama' ? built.maxTokens || 1000 : 150;
            const resp = await race(modelRouter.call(message, { systemPrompt: built.prompt, maxTokens: mt }), 60000);
            response = typeof resp === 'string' ? resp : (resp.content?.[0]?.text || JSON.stringify(resp));
            _routedTo = 'llama';
          } else {
            try {
              const dr = await deepMode.callDeep(message, built.prompt, { type: built.type, maxTokens: built.maxTokens });
              response = dr.text;
              _routedTo = dr.isDeep ? 'claude-deep' : 'claude';
            } catch (e) {
              if (modelRouter) { const fb = await modelRouter.call(message, { systemPrompt: built.prompt, maxTokens: 400 }); response = typeof fb === 'string' ? fb : (fb.content?.[0]?.text || ''); _routedTo = 'llama-fallback'; }
              else throw e;
            }
          }
        }
        if (response && response.length > 20) promptEngine.setCached(message, response);
      }
    }
    history.push({ role: 'assistant', content: response, ts: Date.now() });
    setImmediate(() => {
      try { if (selfImprove) selfImprove.rateResponse(message, response, { hasWebData: false }); } catch {}
      try { if (selfAwareness) selfAwareness.analyzeResponse(response, message); } catch {}
      try { if (persistentIdentity) persistentIdentity.updateFromConversation(message, response, sessionId); } catch {}
      try { if (knowledgeGraph) knowledgeGraph.extractFromConversation(message, response); } catch {}
      try { if (vectorMem) vectorMem.indexConversation(sessionId, message, response); } catch {}
      try { if (episodicMem) episodicMem.addEpisode({ text: message + '\n' + response, sessionId, role: 'exchange' }); } catch {}
      try { if (autoDoc) autoDoc.extractFromConversation(message, response, sessionId); } catch {}
      try { if (causalEngine) causalEngine.extractEventFromConversation(message, response); } catch {}
    });
    saveChatSession(sessionId, history);
    if (history.length > 20) history.splice(0, history.length - 20);
    setImmediate(() => {
      try { require('./session-context').updateProfile(message, response).catch(() => {}); } catch {}
      try { cogModule.learn(message, response); } catch(e) {}
      try { longTermMemory.extractAndStore(message, response); } catch(e) {}
      try {
          const quality = selfImproveModule.analyzeResponseQuality(message, response);
          rlModule.learn(message, built?.type, _routedTo || 'claude', quality, Date.now() - _startTime);
        } catch(e) {}
        try { selfImproveModule.recordResponse(message, response, { promptType: built?.type, routedTo: _routedTo, duration: Date.now() - _startTime }); } catch(e) {}
    });
    clearTimeout(chatTimer);
    if (!res.headersSent) res.json({ response, sessionId, messageCount: history.length, mode, routedTo: _routedTo });
  } catch (e) { clearTimeout(chatTimer); if (!res.headersSent) res.status(500).json({ error: e.message }); }
});

// SSE Streaming chat — must be before :sessionId route
async function handleStreamChat(req, res, message, sessionId, mode) {
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': '*' });
  res.flushHeaders();
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch(e) {} };
  send('start', { sessionId, mode, timestamp: new Date().toISOString() });
  if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, loadChatSession(sessionId));
  const history = chatHistories.get(sessionId);
  history.push({ role: 'user', content: message, ts: Date.now() });
  let webContext = '';
  try {
    if (webIntel) {
      const intent = webIntel.detectIntent(message);
      if (intent !== 'search' || /météo|sport|news|bitcoin|bourse|film|heure|recette/i.test(message)) {
        send('webfetch', { intent, status: 'fetching' });
        const wr = await webIntel.smartSearch(message, { intent });
        if (wr.data && !wr.error) { webContext = webIntel.formatForAI(wr); send('webdata', { intent, ready: true }); }
      }
    }
  } catch(e) {}
  const hist = history.slice(-8).map(m => `[${m.role === 'user' ? 'USER' : 'PROMETHEUS'}]: ${m.content}`).join('\n');
  let ragCtx = '';
  try { if (ragEngine) ragCtx = ragEngine.searchForPrompt(message); } catch(e) {}
  let episodicCtx = '';
  try { if (episodicMem) episodicCtx = await episodicMem.getRelevantContext(message, 3); } catch(e) {}
  const sysPrompt = buildPrometheusPrompt(hist) + (webContext ? '\n\n' + webContext : '') + (ragCtx ? '\n\n' + ragCtx : '') + (episodicCtx ? '\n\n' + episodicCtx : '');
  let fullResponse = '';
  try {
    await streamBridge.callStreaming(message, {
      systemPrompt: sysPrompt, maxTokens: 2000,
      onToken: (token) => { fullResponse += token; send('token', { text: token }); },
      onDone: (full) => { fullResponse = full; },
      onError: (err) => { send('error', { message: err }); },
    });
  } catch(e) {
    try {
      const bridge = require('./claude-api-bridge');
      send('fallback', { reason: 'streaming_failed' });
      const resp = await bridge.call(message, { systemPrompt: sysPrompt, maxTokens: 2000 });
      fullResponse = typeof resp === 'string' ? resp : resp.content?.[0]?.text || JSON.stringify(resp);
      const chunks = fullResponse.match(/.{1,30}/g) || [];
      for (const chunk of chunks) { send('token', { text: chunk }); await new Promise(r => setTimeout(r, 15)); }
    } catch(e2) { send('error', { message: e2.message }); fullResponse = 'Erreur: ' + e2.message; }
  }
  history.push({ role: 'assistant', content: fullResponse, ts: Date.now() });
  if (history.length > 30) history.splice(0, history.length - 30);
  saveChatSession(sessionId, history);
  try { projMemory.learnFromConversation(sessionId, message, fullResponse); } catch(e) {}
  try { if (knowledgeGraph) knowledgeGraph.extractFromConversation(message, fullResponse); } catch(e) {}
  try { if (selfImprove) selfImprove.rateResponse(message, fullResponse, { hasWebData: !!webContext }); } catch(e) {}
  try { if (selfAwareness) { const aw = selfAwareness.analyzeResponse(fullResponse, message); /* could add to response */ } } catch(e) {}
  try { if (persistentIdentity) persistentIdentity.updateFromConversation(message, fullResponse, sessionId); } catch(e) {}
  try { if (vectorMem) vectorMem.indexConversation(sessionId, message, fullResponse); } catch(e) {}
  try { if (episodicMem) episodicMem.addEpisode({ text: message + '\n' + fullResponse, sessionId, role: 'exchange' }); } catch(e) {}
  try { if (autoDoc) autoDoc.extractFromConversation(message, fullResponse, sessionId); } catch(e) {}
  try { if (causalEngine) causalEngine.extractEventFromConversation(message, fullResponse); } catch(e) {}
  try { analytics.track('chat', { responseMs: 0 }); } catch(e) {}
  send('done', { sessionId, mode, messageCount: history.length, timestamp: new Date().toISOString() });
  res.end();
}

app.get('/prometheus/chat/sessions', (req, res) => { res.json(listChatSessions()); });
app.get('/prometheus/chat/stream', async (req, res) => {
  const { message, sessionId = 'local-chat', mode = 'chat' } = req.query;
  if (!message) return res.status(400).json({ error: 'message requis' });
  await handleStreamChat(req, res, message, sessionId, mode);
});
app.get('/prometheus/chat/:sessionId', (req, res) => {
  res.json({ history: chatHistories.get(req.params.sessionId) || [], count: (chatHistories.get(req.params.sessionId) || []).length });
});

// ── PROMETHEUS CHAT ROUTES ──

const chatHistories = new Map();
const CHAT_DIR = path.join(__dirname, 'chat-history');
fs.mkdirSync(CHAT_DIR, { recursive: true });

function loadChatSession(sid) {
  try { const f = path.join(CHAT_DIR, sid.replace(/[^a-z0-9\-_]/gi, '_') + '.json');
    if (fs.existsSync(f)) { const d = JSON.parse(fs.readFileSync(f, 'utf-8')); chatHistories.set(sid, d.messages || []); return d.messages || []; }
  } catch {} return [];
}

function saveChatSession(sid, msgs) {
  try { fs.writeFileSync(path.join(CHAT_DIR, sid.replace(/[^a-z0-9\-_]/gi, '_') + '.json'),
    JSON.stringify({ sessionId: sid, mode: sid.split('-')[0], updatedAt: new Date().toISOString(), messageCount: msgs.length, messages: msgs }, null, 2));
  } catch {}
}

function listChatSessions() {
  try { return fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json')).map(f => {
    try { const d = JSON.parse(fs.readFileSync(path.join(CHAT_DIR, f), 'utf-8'));
      return { sessionId: d.sessionId, mode: d.mode || 'chat', messageCount: d.messageCount || 0, updatedAt: d.updatedAt, preview: d.messages?.slice(-1)[0]?.content?.slice(0, 80) || '' };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); } catch { return []; }
}

// Load existing chat history from disk
try { fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json')).forEach(f => {
  try { const d = JSON.parse(fs.readFileSync(path.join(CHAT_DIR, f), 'utf-8'));
    if (d.sessionId && d.messages) chatHistories.set(d.sessionId, d.messages);
  } catch {} });
  if (chatHistories.size > 0) console.log(`  [Chat] ${chatHistories.size} sessions restored`);
} catch {}

app.post('/remote/prometheus/chat', requireRemoteAuth, async (req, res) => {
  try {
    const { message, sessionId = 'prometheus-shadowroot', mode = 'chat' } = req.body;
    if (!message) return res.status(400).json({ error: 'Message requis' });

    if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, loadChatSession(sessionId));
    const history = chatHistories.get(sessionId);
    history.push({ role: 'user', content: message, ts: Date.now() });

    let response;

    if (mode === 'command' && nlCmd) {
      const result = await nlCmd.interpretAndExecute(message);
      response = result.success
        ? JSON.stringify(result.results, null, 2)
        : 'Erreur: ' + (result.results?.[0]?.error || 'Commande non reconnue');

    } else if (mode === 'mission' && prometheus) {
      const missionResult = await prometheus.executeObjective(message, {
        projectMemory: { name: 'remote-chat', techStack: ['macOS'] }, sessionHistory: []
      });
      response = missionResult.success
        ? `Mission completee en ${missionResult.duration || '?'}s`
        : `Mission: ${JSON.stringify(missionResult).slice(0, 500)}`;

    } else {
      const bridge = require('./claude-api-bridge');
      const histContext = history.slice(-8).map(m =>
        `[${m.role === 'user' ? 'HUMAIN' : 'PROMETHEUS'}]: ${m.content}`
      ).join('\n');

      const resp = await bridge.call(message, {
        systemPrompt: buildPrometheusPrompt(histContext),
        maxTokens: 1200, useCache: false
      });
      response = resp.content[0].text;
    }

    history.push({ role: 'assistant', content: response, ts: Date.now() });
    saveChatSession(sessionId, history);
    if (history.length > 30) history.splice(0, history.length - 30);

    res.json({ response, sessionId, messageCount: history.length, mode });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/prometheus/chat/sessions', requireRemoteAuth, (req, res) => { res.json(listChatSessions()); });
app.get('/remote/prometheus/chat/:sessionId', requireRemoteAuth, (req, res) => {
  res.json({ history: chatHistories.get(req.params.sessionId) || [], count: (chatHistories.get(req.params.sessionId) || []).length });
});

app.delete('/remote/prometheus/chat/:sessionId', requireRemoteAuth, (req, res) => {
  chatHistories.delete(req.params.sessionId);
  res.json({ cleared: true });
});

app.get('/remote/prometheus/status', requireRemoteAuth, (req, res) => {
  res.json({
    available: true, model: 'claude-opus-4-7', system: 'PROMETHEUS v10.0',
    capabilities: ['Chat conversationnel', 'Controle Mac complet', 'Missions autonomes', 'Screenshots & vision', 'Gestion fichiers', 'Shell commands']
  });
});

// ── TELEGRAM ROUTES ──

let telegram;
try { telegram = require('./telegram-notifier'); telegram.init(); } catch { telegram = null; }

app.post('/telegram/configure', requireRemoteAuth, (req, res) => {
  const { token, chatId } = req.body;
  if (!token || !chatId) return res.status(400).json({ error: 'token and chatId required' });
  if (!telegram) return res.status(503).json({ error: 'Telegram module not available' });
  const ok = telegram.configure(token, chatId);
  if (ok) telegram.send('\u2705 PROMETHEUS connected to Telegram!');
  res.json({ success: ok });
});

app.get('/telegram/test', requireRemoteAuth, async (req, res) => {
  if (!telegram) return res.status(503).json({ error: 'Telegram not available' });
  const sent = await telegram.send('\uD83D\uDD25 Test notification from PROMETHEUS v10.0');
  res.json({ sent });
});

// ── TOKEN ROUTES ──

let tokenOpt;
try { tokenOpt = require('./token-optimizer'); } catch { tokenOpt = null; }

app.get('/tokens/stats', (req, res) => {
  res.json(tokenOpt ? tokenOpt.budgetManager.getStats() : {});
});

app.get('/tokens/cache', (req, res) => {
  const bridgeStats = require('./claude-api-bridge').getStats();
  res.json({ semanticCacheSize: tokenOpt ? tokenOpt.semanticCache.size : 0, bridgeCacheHitRate: bridgeStats.cacheHitRate, tokensSaved: tokenOpt ? tokenOpt.budgetManager.getStats().tokensSaved : 0 });
});

app.post('/tokens/clear-cache', (req, res) => {
  if (tokenOpt) tokenOpt.semanticCache.clear();
  require('./claude-api-bridge').clearCache();
  res.json({ success: true });
});

// ── PROMETHEUS ROUTES ──

if (prometheus) {
  prometheus.on('mission_start', d => broadcast({ event: 'prometheus_mission_start', ...d }));
  prometheus.on('mission_step', d => broadcast({ event: 'prometheus_step', ...d }));
  prometheus.on('mission_complete', d => broadcast({ event: 'prometheus_complete', ...d }));
  prometheus.on('mission_error', d => broadcast({ event: 'prometheus_error', ...d }));
  prometheus.on('self_healed', d => broadcast({ event: 'prometheus_healed', ...d }));
}

app.post('/prometheus/execute', async (req, res) => {
  const { objective, projectName } = req.body;
  if (!objective) return res.status(400).json({ error: 'objective required' });
  if (!prometheus) return res.status(503).json({ error: 'Prometheus not available' });
  try {
    const pm = projectMemory.loadProject(projectName || 'default');
    const result = await prometheus.executeObjective(objective, { projectMemory: pm, sessionHistory: [] });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/prometheus/consciousness', (req, res) => {
  const state = prometheus ? prometheus.getState() : { state: 'unavailable' };
  res.json({ system: 'PROMETHEUS v10.0 — Autonomous Chief', status: state.state === 'operational' ? 'OPERATIONAL' : state.state, ...state });
});

app.get('/prometheus/diagnostic', async (req, res) => {
  if (!selfHealer) return res.status(503).json({ error: 'Self-healer not available' });
  res.json(await selfHealer.runDiagnostic());
});

app.post('/prometheus/heal', async (req, res) => {
  if (!selfHealer) return res.status(503).json({ error: 'Self-healer not available' });
  const result = await selfHealer.heal({ message: req.body.error || 'unknown' }, {});
  res.json(result);
});

app.get('/prometheus/mission/:id', (req, res) => {
  if (!prometheus) return res.status(503).end();
  const mission = prometheus.getMission(req.params.id);
  res.json(mission || { error: 'Mission not found' });
});

// ── SECURITY ROUTES ──

app.get('/security/report', (req, res) => {
  res.json(securityFortress ? securityFortress.getSecurityReport() : {});
});

app.get('/security/logs', (req, res) => {
  const logPath = path.join(__dirname, 'logs', 'security.log');
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean).slice(-100);
    res.json({ lines });
  } catch { res.json({ lines: [] }); }
});

app.post('/security/unblock', (req, res) => {
  if (!securityFortress || !req.body.ip) return res.status(400).json({ error: 'ip required' });
  securityFortress.BLOCKED_IPS.delete(req.body.ip);
  res.json({ success: true });
});

app.get('/prometheus', (req, res) => res.sendFile(path.join(__dirname, 'public', 'prometheus.html')));

// ── VISION ROUTES ──

if (streamManager) streamManager.init(broadcast);

app.get('/remote/vision/screenshot', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).json({ error: 'Vision engine not available' });
  try {
    const opts = { quality: req.query.quality || 'high', format: req.query.format || 'jpeg', cursor: req.query.cursor === 'true', display: parseInt(req.query.display) || 0 };
    if (req.query.x) opts.region = { x: parseInt(req.query.x), y: parseInt(req.query.y), width: parseInt(req.query.width), height: parseInt(req.query.height) };
    const result = await vision.captureScreen(opts);
    res.set('Content-Type', `image/${opts.format === 'jpg' ? 'jpeg' : opts.format}`);
    res.send(result.buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/screenshot/window/:appName', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).end();
  try {
    const result = await vision.captureWindow(req.params.appName, { quality: req.query.quality || 'high', format: req.query.format || 'jpeg' });
    res.set('Content-Type', `image/${req.query.format === 'png' ? 'png' : 'jpeg'}`);
    res.send(result.buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/screenshot/all-displays', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).end();
  try {
    const caps = await vision.captureAllDisplays();
    res.json(caps.map(c => ({ display: c.display, imageBase64: c.buffer.toString('base64'), size: c.size, originalSize: c.originalSize })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/vision/screenshot/annotated', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).end();
  try {
    const result = await vision.captureScreen({ quality: req.body.quality || 'high', format: 'jpeg', annotate: { text: req.body.text, x: req.body.x || 10, y: req.body.y || 30, color: req.body.color || '#58a6ff' } });
    res.set('Content-Type', 'image/jpeg');
    res.send(result.buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/displays', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).end();
  try { res.json({ count: await vision.getDisplayCount() }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/windows', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).end();
  try { res.json(await vision.getOpenWindows()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/stream/start', requireRemoteAuth, (req, res) => {
  if (!streamManager) return res.status(503).end();
  const clientId = req.query.clientId || `c-${Date.now()}`;
  const result = streamManager.addClient(clientId, { quality: req.query.quality || 'medium', fps: parseInt(req.query.fps) || 10 });
  res.json({ success: true, ...result });
});

app.get('/remote/vision/stream/stop', requireRemoteAuth, (req, res) => {
  if (!streamManager) return res.status(503).end();
  streamManager.removeClient(req.query.clientId);
  res.json({ success: true });
});

app.get('/remote/vision/stream/quality', requireRemoteAuth, (req, res) => {
  if (!streamManager) return res.status(503).end();
  streamManager.updateClientQuality(req.query.clientId, req.query.quality || 'medium');
  res.json({ success: true });
});

app.get('/remote/vision/stream/stats', requireRemoteAuth, (req, res) => {
  if (!streamManager) return res.status(503).end();
  res.json(streamManager.getStats());
});

app.post('/remote/vision/record/start', requireRemoteAuth, async (req, res) => {
  if (!videoRecorder) return res.status(503).json({ error: 'Video recorder not available' });
  try { res.json(await videoRecorder.startRecording(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/vision/record/stop', requireRemoteAuth, async (req, res) => {
  if (!videoRecorder) return res.status(503).end();
  try { res.json(await videoRecorder.stopRecording(req.body.sessionId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/record/active', requireRemoteAuth, (req, res) => {
  if (!videoRecorder) return res.status(503).end();
  res.json(videoRecorder.getActiveRecordings());
});

app.post('/remote/vision/gif', requireRemoteAuth, async (req, res) => {
  if (!videoRecorder) return res.status(503).end();
  try {
    const result = await videoRecorder.captureGif(req.body);
    broadcast({ event: 'gif_done', ...result });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/remote/vision/timelapse', requireRemoteAuth, async (req, res) => {
  if (!videoRecorder) return res.status(503).end();
  try {
    const result = await videoRecorder.captureTimelapse(req.body);
    broadcast({ event: 'timelapse_done', ...result });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/remote/vision/download/:filename', (req, res) => {
  const screenshotsDir = vision ? vision.SCREENSHOTS_DIR : path.join(__dirname, 'downloads', 'screenshots');
  const videosDir = vision ? vision.VIDEOS_DIR : path.join(__dirname, 'downloads', 'videos');
  const fn = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  for (const dir of [screenshotsDir, videosDir]) {
    const fp = path.join(dir, fn);
    if (fs.existsSync(fp)) return res.download(fp, fn);
  }
  res.status(404).json({ error: 'File not found' });
});

app.get('/remote/vision/gallery', requireRemoteAuth, (req, res) => {
  const items = [];
  const dirs = [
    { dir: vision ? vision.SCREENSHOTS_DIR : path.join(__dirname, 'downloads', 'screenshots'), type: 'image' },
    { dir: vision ? vision.VIDEOS_DIR : path.join(__dirname, 'downloads', 'videos'), type: 'video' }
  ];
  for (const { dir, type } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      const t = f.endsWith('.gif') ? 'gif' : type;
      items.push({ filename: f, type: t, size: stat.size, timestamp: stat.mtimeMs, url: `/remote/vision/download/${f}` });
    }
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  res.json(items);
});

app.delete('/remote/vision/gallery/:filename', requireRemoteAuth, (req, res) => {
  const fn = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  const dirs = [vision ? vision.SCREENSHOTS_DIR : path.join(__dirname, 'downloads', 'screenshots'), vision ? vision.VIDEOS_DIR : path.join(__dirname, 'downloads', 'videos')];
  for (const dir of dirs) {
    const fp = path.join(dir, fn);
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); return res.json({ success: true }); }
  }
  res.status(404).json({ error: 'File not found' });
});

app.get('/remote/vision/mjpeg', requireRemoteAuth, async (req, res) => {
  if (!vision) return res.status(503).end();
  const quality = req.query.quality || 'medium';
  res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const interval = setInterval(async () => {
    try {
      const { buffer } = await vision.captureScreen({ quality, format: 'jpeg' });
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`);
      res.write(buffer);
      res.write('\r\n');
    } catch {}
  }, 100);
  req.on('close', () => clearInterval(interval));
});

app.get('/vision', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vision.html')));

// ── WEBSOCKET ──

wss.on('connection', (ws, req) => {
  log('WS', '-', 'Client connected');
  ws.send(JSON.stringify({ event: 'connected', message: 'PROMETHEUS v10.0 WebSocket ready' }));
});

// ── EXPORT FOR TESTING ──
function getInstances() { return instances; }
function getAutoMode() { return autoModeInstances; }
// ── WEB INTELLIGENCE ROUTES ──
let webIntel;
try { webIntel = require('./web-intelligence'); setTimeout(() => { try { webIntel.warmupCache(); } catch(e){} }, 3000); } catch { webIntel = null; }

if (webIntel) {
  const wr = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(500).json({ error: e.message }); } };
  const q = (r, k) => r.query[k];
  const qr = (r, k, d) => r.query[k] || d;

  // Search & AI
  app.get('/web/search', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.smartSearch(q(r,'q'), { intent: q(r,'intent') }); }));
  app.get('/web/intent', wr(r => { if (!q(r,'q')) throw new Error('q required'); return { intent: webIntel.detectIntent(q(r,'q')) }; }));

  // Weather (3)
  app.get('/web/weather', wr(r => webIntel.getWeather(qr(r,'city','Paris'))));
  app.get('/web/weather/compare', wr(r => { if (!q(r,'cities')) throw new Error('cities required'); return webIntel.compareWeather(q(r,'cities').split(',')); }));
  app.get('/web/weather/alerts', wr(r => webIntel.getWeatherAlerts(qr(r,'country','FR'))));

  // Sports (4)
  app.get('/web/sports', wr(r => webIntel.getSports(qr(r,'league','ligue1'))));
  app.get('/web/standings', wr(r => webIntel.getStandings(qr(r,'league','ligue1'))));
  app.get('/web/sports/player', wr(r => { if (!q(r,'name')) throw new Error('name required'); return webIntel.getPlayerStats(q(r,'name')); }));
  app.get('/web/sports/f1', wr(r => webIntel.getF1Calendar()));
  app.get('/web/sports/f1/standings', wr(r => webIntel.getF1Standings()));

  // News (3)
  app.get('/web/news', wr(r => webIntel.getNews(qr(r,'source','monde'), { limit: parseInt(qr(r,'limit','10')) })));
  app.get('/web/news/multi', wr(r => webIntel.getMultiNews((qr(r,'sources','monde,techcrunch,hackernews')).split(','), { limit: parseInt(qr(r,'limit','5')) })));
  app.get('/web/news/search', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchNews(q(r,'q'), { limit: parseInt(qr(r,'limit','10')) }); }));

  // Finance (5)
  app.get('/web/crypto', wr(r => webIntel.getCrypto((qr(r,'coins','bitcoin,ethereum,solana')).split(','))));
  app.get('/web/crypto/detail', wr(r => webIntel.getCryptoDetail(qr(r,'coin','bitcoin'))));
  app.get('/web/crypto/global', wr(r => webIntel.getGlobalCryptoStats()));
  app.get('/web/crypto/defi', wr(r => webIntel.getDefiProtocols()));
  app.get('/web/finance', wr(r => webIntel.getStockPrice(qr(r,'symbol','AAPL'))));
  app.get('/web/finance/stock', wr(r => webIntel.getStock(qr(r,'symbol','AAPL'))));
  app.get('/web/finance/multi', wr(r => webIntel.getMultipleStocks((qr(r,'symbols','AAPL,MSFT,GOOGL')).split(','))));
  app.get('/web/indices', wr(r => webIntel.getMarketIndices()));
  app.get('/web/forex', wr(r => webIntel.getForex(qr(r,'base','EUR'), (qr(r,'targets','USD,GBP,CHF,JPY')).split(','))));
  app.get('/web/inflation', wr(r => webIntel.getInflationData(qr(r,'country','france'))));
  app.get('/web/economic', wr(r => webIntel.getEconomicIndicators()));

  // Transport (3)
  app.get('/web/flights', wr(r => { const opts = {}; if(q(r,'lat')&&q(r,'lon')){const d=parseFloat(qr(r,'delta','1'));opts.lamin=parseFloat(q(r,'lat'))-d;opts.lamax=parseFloat(q(r,'lat'))+d;opts.lomin=parseFloat(q(r,'lon'))-d;opts.lomax=parseFloat(q(r,'lon'))+d;} if(q(r,'icao24'))opts.icao24=q(r,'icao24'); return webIntel.getFlights(opts); }));
  app.get('/web/airport', wr(r => webIntel.getAirportInfo(qr(r,'code','CDG'))));
  app.get('/web/transit', wr(r => webIntel.getPublicTransit(qr(r,'city','Paris'))));

  // Entertainment (5)
  app.get('/web/tv', wr(r => webIntel.getTVShows({ type: qr(r,'type','trending') })));
  app.get('/web/movies/search', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchMovie(q(r,'q')); }));
  app.get('/web/music', wr(r => webIntel.getMusicCharts()));
  app.get('/web/books', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.getBooks(q(r,'q')); }));
  app.get('/web/games', wr(r => webIntel.getVideoGames()));
  app.get('/web/podcasts', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.getPodcasts(q(r,'q')); }));

  // Geo (4)
  app.get('/web/geocode', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.geocode(q(r,'q')); }));
  app.get('/web/reverse-geocode', wr(r => { if (!q(r,'lat') || !q(r,'lon')) throw new Error('lat,lon required'); return webIntel.reverseGeocode(parseFloat(q(r,'lat')), parseFloat(q(r,'lon'))); }));
  app.get('/web/distance', wr(r => { if (!q(r,'from') || !q(r,'to')) throw new Error('from,to required'); return webIntel.getDistance(q(r,'from'), q(r,'to')); }));
  app.get('/web/nearby', wr(r => { if (!q(r,'lat') || !q(r,'lon')) throw new Error('lat,lon required'); return webIntel.getNearbyPlaces(parseFloat(q(r,'lat')), parseFloat(q(r,'lon')), { type: q(r,'type') }); }));
  app.get('/web/country', wr(r => webIntel.getCountryInfo(qr(r,'code','FR'))));

  // Science (3)
  app.get('/web/science', wr(r => webIntel.getNASA({ type: qr(r,'type','apod') })));
  app.get('/web/earthquakes', wr(r => webIntel.getEarthquakes({ minMagnitude: parseFloat(qr(r,'min','4')) })));
  app.get('/web/space', wr(r => webIntel.getSpaceEvents()));

  // Health (2)
  app.get('/web/drug', wr(r => { if (!q(r,'name')) throw new Error('name required'); return webIntel.searchDrug(q(r,'name')); }));
  app.get('/web/drug/eu', wr(r => { if (!q(r,'name')) throw new Error('name required'); return webIntel.searchDrugEU(q(r,'name')); }));
  app.get('/web/nutrition', wr(r => { if (!q(r,'food')) throw new Error('food required'); return webIntel.getNutrition(q(r,'food')); }));

  // Language (3)
  app.post('/web/translate', wr(r => { if (!r.body.text) throw new Error('text required'); return webIntel.translate(r.body.text, { from: r.body.from, to: r.body.to }); }));
  app.get('/web/detect-lang', wr(r => { if (!q(r,'text')) throw new Error('text required'); return webIntel.detectLanguage(q(r,'text')); }));
  app.get('/web/dictionary', wr(r => { if (!q(r,'word')) throw new Error('word required'); return webIntel.getDictionary(q(r,'word'), qr(r,'lang','en')); }));

  // Utility (4)
  app.get('/web/calculate', (req, res) => { if (!q(req,'expr')) return res.status(400).json({ error: 'expr required' }); res.json(webIntel.calculate(q(req,'expr'))); });
  app.get('/web/convert', (req, res) => { const { value, from, to } = req.query; if (!value || !from || !to) return res.status(400).json({ error: 'value,from,to required' }); res.json(webIntel.convert(parseFloat(value), from, to)); });
  app.get('/web/time', wr(r => webIntel.getTime(qr(r,'tz','Europe/Paris'))));
  app.get('/web/clocks', wr(r => webIntel.getWorldClocks()));

  // Food (2)
  app.get('/web/recipe', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchRecipe(q(r,'q')); }));
  app.get('/web/cocktail', wr(r => webIntel.getCocktail(qr(r,'name','mojito'))));

  // Dev (6)
  app.get('/web/github', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchGitHub(q(r,'q')); }));
  app.get('/web/npm', wr(r => { if (!q(r,'name')) throw new Error('name required'); return webIntel.getNpmPackage(q(r,'name')); }));
  app.get('/web/pypi', wr(r => { if (!q(r,'name')) throw new Error('name required'); return webIntel.getPyPIPackage(q(r,'name')); }));
  app.get('/web/hackernews', wr(r => webIntel.getHackerNews()));
  app.get('/web/producthunt', wr(r => webIntel.getProductHunt()));
  app.get('/web/docker', wr(r => { if (!q(r,'name')) throw new Error('name required'); return webIntel.getDockerHub(q(r,'name')); }));

  // Knowledge (3)
  app.get('/web/wiki', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.getWikipedia(q(r,'q'), { lang: q(r,'lang') }); }));
  app.get('/web/math', wr(r => { if (!q(r,'expr')) throw new Error('expr required'); return webIntel.getMathProof(q(r,'expr')); }));
  app.get('/web/academic', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchAcademic(q(r,'q')); }));

  // Network (4)
  app.get('/web/website', wr(r => { if (!q(r,'url')) throw new Error('url required'); return webIntel.checkWebsite(q(r,'url')); }));
  app.get('/web/domain', wr(r => { if (!q(r,'domain')) throw new Error('domain required'); return webIntel.getDomainInfo(q(r,'domain')); }));
  app.get('/web/ip', wr(r => webIntel.getIPInfo(q(r,'ip'))));
  app.get('/web/shorten', wr(r => { if (!q(r,'url')) throw new Error('url required'); return webIntel.shortenURL(q(r,'url')); }));

  // Images
  app.get('/web/images', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchImages(q(r,'q')); }));

  // Alias routes (test compatibility)
  app.get('/web/translate', wr(r => { if (!q(r,'text')) throw new Error('text required'); return webIntel.translate(q(r,'text'), { from: q(r,'from'), to: qr(r,'to','en') }); }));
  app.get('/web/sports/leagues', (req, res) => { res.json(webIntel.LEAGUES ? Object.keys(webIntel.LEAGUES).map(k => ({ id: k, ...webIntel.LEAGUES[k] })) : []); });
  app.get('/web/news/sources', (req, res) => { res.json(webIntel.NEWS_SOURCES ? Object.keys(webIntel.NEWS_SOURCES).map(k => ({ id: k, url: webIntel.NEWS_SOURCES[k] })) : []); });
  app.get('/web/crypto/detail/:coin', wr(r => webIntel.getCryptoDetail(r.params.coin)));
  app.get('/web/finance/stock', wr(r => webIntel.getStock(qr(r,'symbol','AAPL'))));
  app.get('/web/finance/multi', wr(r => webIntel.getMultipleStocks((qr(r,'symbols','AAPL,MSFT,GOOGL')).split(','))));
  app.get('/web/finance/indices', wr(r => webIntel.getMarketIndices()));
  app.get('/web/economy', wr(r => webIntel.getEconomicIndicators()));
  app.get('/web/health', wr(r => { if (!q(r,'drug')) throw new Error('drug required'); return webIntel.searchDrug(q(r,'drug')); }));
  app.get('/web/check', wr(r => { if (!q(r,'url')) throw new Error('url required'); return webIntel.checkWebsite(q(r,'url')); }));
  app.get('/web/arxiv', wr(r => { if (!q(r,'q')) throw new Error('q required'); return webIntel.searchAcademic(q(r,'q')); }));
  app.get('/web/time/world', wr(r => { const cities = q(r,'cities'); return webIntel.getWorldClocks(cities ? cities.split(',').map(c => { const map = {Paris:'Europe/Paris','New York':'America/New_York',Tokyo:'Asia/Tokyo',London:'Europe/London',Dubai:'Asia/Dubai',Sydney:'Australia/Sydney'}; return map[c] || c; }) : undefined); }));
  app.get('/web/movies', wr(r => { if (q(r,'q')) return webIntel.searchMovie(q(r,'q')); return webIntel.getMovies({ type: qr(r,'type','trending') }); }));

  // Capabilities
  app.get('/web/capabilities', (req, res) => {
    const fns = Object.keys(webIntel).filter(k => typeof webIntel[k] === 'function');
    res.json({ version: '2.0', routes: 65, functions: fns.length, categories: ['weather','sports','news','crypto','finance','transport','entertainment','geo','science','health','language','utility','food','dev','knowledge','network','images'], leagues: webIntel.LEAGUES ? Object.keys(webIntel.LEAGUES) : [], news_sources: webIntel.NEWS_SOURCES ? Object.keys(webIntel.NEWS_SOURCES) : [], crypto_ids: webIntel.CRYPTO_IDS || [], lang_codes: webIntel.LANG_CODES ? Object.keys(webIntel.LANG_CODES) : [], intents: webIntel.INTENTS ? webIntel.INTENTS.length : 0 });
  });
}

app.post('/prometheus/chat/stream', async (req, res) => {
  const { message, sessionId = 'local-chat', mode = 'chat' } = req.body;
  if (!message) return res.status(400).json({ error: 'message requis' });
  await handleStreamChat(req, res, message, sessionId, mode);
});

app.post('/remote/prometheus/chat/stream', requireRemoteAuth, async (req, res) => {
  const { message, sessionId = 'prometheus-shadowroot', mode = 'chat' } = req.body;
  if (!message) return res.status(400).json({ error: 'message requis' });
  await handleStreamChat(req, res, message, sessionId, mode);
});

// 2FA TOTP
app.post('/auth/2fa/setup', requireRemoteAuth, async (req, res) => {
  try { res.json(await totpAuth.setup2FA()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/auth/2fa/confirm', requireRemoteAuth, (req, res) => {
  if (!req.body.token) return res.status(400).json({ error: 'token requis' });
  res.json(totpAuth.confirm2FA(req.body.token));
});
app.post('/auth/2fa/disable', requireRemoteAuth, (req, res) => {
  if (!req.body.token) return res.status(400).json({ error: 'token requis' });
  res.json(totpAuth.disable2FA(req.body.token));
});
app.get('/auth/2fa/status', requireRemoteAuth, (req, res) => { res.json({ enabled: totpAuth.is2FAEnabled() }); });

// Project Memory
app.get('/memory/stats', (req, res) => { try { res.json(projMemory.getStats()); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/memory/context/:sessionId', requireRemoteAuth, (req, res) => { try { res.json({ context: projMemory.getActiveContext(req.params.sessionId) }); } catch(e) { res.status(500).json({error:e.message}); } });
app.delete('/memory/session/:sessionId', requireRemoteAuth, (req, res) => { try { projMemory.clearSession(req.params.sessionId); res.json({success:true}); } catch(e) { res.status(500).json({error:e.message}); } });

// Analytics
app.get('/analytics', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'analytics.html')));
app.get('/analytics/data', (req, res) => { try { res.json(analytics.getReport()); } catch(e) { res.status(500).json({error:e.message}); } });

// Backup
app.get('/backup/list', requireRemoteAuth, (req, res) => { try { res.json(backupMgr.listBackups()); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/backup/create', requireRemoteAuth, async (req, res) => { try { res.json(await backupMgr.createSnapshot()); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/backup/cleanup', requireRemoteAuth, (req, res) => { try { res.json(backupMgr.cleanup()); } catch(e) { res.status(500).json({error:e.message}); } });

// ══ VISION ENGINE v8.0 ══
app.get('/vision/status', (req, res) => res.json(vision ? vision.getStatus() : { error: 'not loaded' }));
app.post('/vision/start', requireRemoteAuth, (req, res) => res.json(vision ? vision.start(req.body.intervalMs) : { error: 'not loaded' }));
app.post('/vision/stop', requireRemoteAuth, (req, res) => res.json(vision ? vision.stop() : { error: 'not loaded' }));
app.get('/vision/capture', requireRemoteAuth, async (req, res) => { try { res.json(await vision.captureAndAnalyze()); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/vision/anomalies', (req, res) => res.json(vision ? vision.getAnomalies() : []));
app.get('/vision/history', (req, res) => res.json(vision ? vision.getHistory() : []));
app.get('/vision/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.flushHeaders();
  if (!vision) return res.end();
  const onFrame = (data) => { try { res.write(`event: frame\ndata: ${JSON.stringify(data)}\n\n`); } catch(e) {} };
  const onAnomaly = (data) => { try { res.write(`event: anomaly\ndata: ${JSON.stringify(data)}\n\n`); } catch(e) {} };
  vision.on('frame', onFrame);
  vision.on('anomaly', onAnomaly);
  req.on('close', () => { vision.removeListener('frame', onFrame); vision.removeListener('anomaly', onAnomaly); });
});

// ══ VECTOR MEMORY v8.0 ══
app.get('/vector/search', (req, res) => {
  if (!req.query.q) return res.status(400).json({ error: 'q required' });
  res.json(vectorMem ? vectorMem.search(req.query.q, { limit: parseInt(req.query.limit) || 10 }) : { error: 'not loaded' });
});
app.get('/vector/stats', (req, res) => res.json(vectorMem ? vectorMem.getStats() : { error: 'not loaded' }));
app.post('/vector/index', requireRemoteAuth, (req, res) => {
  if (!req.body.text) return res.status(400).json({ error: 'text required' });
  res.json(vectorMem ? vectorMem.addDocument(req.body.text, req.body.metadata) : { error: 'not loaded' });
});
app.post('/vector/reindex', requireRemoteAuth, (req, res) => res.json(vectorMem ? vectorMem.indexExistingHistory() : { error: 'not loaded' }));

// ══ MULTI-AGENTS v8.0 ══
app.get('/agents/status', (req, res) => res.json(multiAgents ? multiAgents.getAgentStatus() : { error: 'not loaded' }));
app.post('/agents/mission', requireRemoteAuth, async (req, res) => {
  if (!req.body.objective) return res.status(400).json({ error: 'objective required' });
  try { res.json(await multiAgents.executeMission(req.body.objective)); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/agents/missions', (req, res) => res.json(multiAgents ? multiAgents.getCompletedMissions() : []));

// ══ SELF-IMPROVE v8.0 ══
app.get('/improve/stats', (req, res) => res.json(selfImprove ? selfImprove.getStats() : { error: 'not loaded' }));
app.get('/improve/ratings', (req, res) => res.json(selfImprove ? selfImprove.getRatings(parseInt(req.query.limit) || 20) : []));
app.get('/improve/evolution', (req, res) => res.json(selfImprove ? selfImprove.getEvolution() : { error: 'not loaded' }));
app.get('/improve/suggestions', (req, res) => res.json(selfImprove ? selfImprove.generatePromptImprovements() : { error: 'not loaded' }));

// ══ MISSIONS AUTONOMES v8.0 ══
app.post('/missions/run', requireRemoteAuth, async (req, res) => {
  if (!req.body.objective) return res.status(400).json({ error: 'objective required' });
  try { res.json(await missionRunner.run(req.body.objective)); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/missions/active', (req, res) => res.json(missionRunner ? missionRunner.getActive() : { error: 'not loaded' }));
app.get('/missions/history', (req, res) => res.json(missionRunner ? missionRunner.getHistory() : []));
app.get('/missions/:id', (req, res) => { const m = missionRunner ? missionRunner.getMission(req.params.id) : null; m ? res.json(m) : res.status(404).json({error:'not found'}); });
app.post('/missions/cancel', requireRemoteAuth, (req, res) => res.json(missionRunner ? missionRunner.cancel() : { error: 'not loaded' }));
app.get('/missions/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.flushHeaders();
  if (!missionRunner) return res.end();
  const emit = (ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch(e) {} };
  const handlers = { start: d => emit('start', d), planned: d => emit('planned', d), step_start: d => emit('step', d), step_done: d => emit('result', d), done: d => emit('done', d) };
  Object.entries(handlers).forEach(([ev, fn]) => missionRunner.on(ev, fn));
  req.on('close', () => { Object.entries(handlers).forEach(([ev, fn]) => missionRunner.removeListener(ev, fn)); });
});

// ══ RAG ENGINE v9.0 ══
app.get('/rag/search', async (req, res) => {
  if (!ragEngine) return res.status(503).json({ error: 'RAG engine not loaded' });
  if (!req.query.q) return res.status(400).json({ error: 'q required' });
  try { res.json(ragEngine.search(req.query.q, { limit: parseInt(req.query.limit) || 10, source: req.query.source })); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/rag/stats', (req, res) => {
  if (!ragEngine) return res.status(503).json({ error: 'RAG engine not loaded' });
  res.json(ragEngine.getStats());
});
app.post('/rag/index', requireRemoteAuth, async (req, res) => {
  if (!ragEngine) return res.status(503).json({ error: 'RAG engine not loaded' });
  try { res.json(await ragEngine.indexAll()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/rag/add', requireRemoteAuth, (req, res) => {
  if (!ragEngine) return res.status(503).json({ error: 'RAG engine not loaded' });
  if (!req.body.text) return res.status(400).json({ error: 'text required' });
  res.json(ragEngine.addDoc(req.body.text, req.body.source || 'manual', req.body.metadata));
});

// ══ KNOWLEDGE GRAPH v9.0 ══
app.get('/graph/nodes', (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  if (req.query.q) return res.json(knowledgeGraph.findNode(req.query.q));
  if (req.query.type) return res.json(knowledgeGraph.getNodesByType(req.query.type));
  res.json(knowledgeGraph.getStats());
});
app.get('/graph/d3', (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  res.json(knowledgeGraph.toD3());
});
app.get('/graph/stats', (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  res.json(knowledgeGraph.getStats());
});
app.get('/graph/related/:id', (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  res.json(knowledgeGraph.getRelated(req.params.id, parseInt(req.query.depth) || 1));
});
app.post('/graph/node', requireRemoteAuth, (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  if (!req.body.label || !req.body.type) return res.status(400).json({ error: 'label and type required' });
  res.json(knowledgeGraph.addNode(req.body.label, req.body.type, req.body.properties));
});
app.post('/graph/relation', requireRemoteAuth, (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  if (!req.body.from || !req.body.to || !req.body.relation) return res.status(400).json({ error: 'from, to, relation required' });
  res.json(knowledgeGraph.addRelation(req.body.from, req.body.to, req.body.relation, req.body.properties));
});
app.delete('/graph/node/:id', requireRemoteAuth, (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  knowledgeGraph.removeNode(req.params.id); res.json({ deleted: true });
});
app.get('/graph/types', (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph not loaded' });
  res.json({ types: knowledgeGraph.TYPES, relations: knowledgeGraph.RELATIONS });
});

// ══ MODEL ROUTER + LLAMA v10.0 ══
const llamaBridge = (() => { try { return require('./llama-bridge'); } catch(e) { return null; } })();

app.post('/model/route', async (req, res) => {
  if (!modelRouter) return res.status(503).json({ error: 'unavailable' });
  if (!req.body.prompt) return res.status(400).json({ error: 'prompt required' });
  try { res.json(await modelRouter.call(req.body.prompt, req.body)); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/model/route-preview', async (req, res) => {
  if (!modelRouter) return res.status(503).json({ error: 'unavailable' });
  if (!req.body.message) return res.status(400).json({ error: 'message required' });
  try { res.json(await modelRouter.routeMessage(req.body.message, req.body)); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/model/stats', (req, res) => { if (!modelRouter) return res.status(503).json({ error: 'unavailable' }); res.json(modelRouter.getStats()); });
app.get('/model/status', async (req, res) => { if (!modelRouter) return res.status(503).json({ error: 'unavailable' }); try { res.json(await modelRouter.getStatus()); } catch(e) { res.json({ error: e.message }); } });
app.get('/model/complexity', (req, res) => {
  if (!req.query.q) return res.status(400).json({ error: 'q required' });
  const { complexityScore } = require('./tree-of-thoughts');
  res.json({ query: req.query.q, complexity: complexityScore(req.query.q) });
});

// Llama direct
app.get('/llama/status', async (req, res) => {
  if (!llamaBridge) return res.json({ available: false, reason: 'module not loaded' });
  const available = await llamaBridge.isOllamaAvailable();
  res.json({ available, model: 'llama3.2:3b', endpoint: 'http://localhost:11434' });
});
app.post('/llama/query', async (req, res) => {
  if (!llamaBridge) return res.status(503).json({ error: 'unavailable' });
  if (!req.body.message) return res.status(400).json({ error: 'message required' });
  try { res.json(await llamaBridge.callLlama(req.body.message, { maxTokens: req.body.maxTokens || 500 })); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ TEMPORAL DAEMON v9.0 ══
app.get('/temporal/status', (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  res.json(temporalDaemon.getStatus());
});
app.post('/temporal/start', requireRemoteAuth, (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  res.json(temporalDaemon.start());
});
app.post('/temporal/stop', requireRemoteAuth, (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  res.json(temporalDaemon.stop());
});
app.post('/temporal/scan', requireRemoteAuth, async (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  await temporalDaemon.fullScan(); res.json({ scanned: true });
});
app.get('/temporal/events', (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  res.json(temporalDaemon.getEvents(parseInt(req.query.limit) || 50));
});
app.get('/temporal/brief', async (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  try { res.json(await temporalDaemon.generateBrief()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/temporal/morning-brief', (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  const brief = temporalDaemon.getLatestBrief();
  brief ? res.json(brief) : res.json({ message: 'Aucun brief disponible — POST /temporal/brief pour en générer un' });
});
app.get('/temporal/config', requireRemoteAuth, (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  res.json(temporalDaemon.getConfig());
});
app.post('/temporal/config', requireRemoteAuth, (req, res) => {
  if (!temporalDaemon) return res.status(503).json({ error: 'Temporal daemon not loaded' });
  res.json(temporalDaemon.updateConfig(req.body));
});

// ══ COMMAND SANDBOX v9.0 ══
app.post('/simulate/command', async (req, res) => {
  if (!commandSandbox) return res.status(503).json({ error: 'Command sandbox not loaded' });
  if (!req.body.command) return res.status(400).json({ error: 'command required' });
  try { res.json(await commandSandbox.simulate(req.body.command)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/simulate/execute', requireRemoteAuth, async (req, res) => {
  if (!commandSandbox) return res.status(503).json({ error: 'Command sandbox not loaded' });
  if (!req.body.command) return res.status(400).json({ error: 'command required' });
  try { res.json(await commandSandbox.safeExecute(req.body.command)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/simulate/log', (req, res) => {
  if (!commandSandbox) return res.status(503).json({ error: 'Command sandbox not loaded' });
  res.json(commandSandbox.getLog(parseInt(req.query.limit) || 30));
});
app.get('/simulate/stats', (req, res) => {
  if (!commandSandbox) return res.status(503).json({ error: 'Command sandbox not loaded' });
  res.json(commandSandbox.getStats());
});

// === Sovereignty Routes ===
// GET routes publiques (lecture seule — pas d'action)
app.get('/sovereignty/status', (req, res) => res.json(sovereignty.getStatus()));
app.get('/sovereignty/audit', (req, res) => res.json(sovereignty.getAuditLog(parseInt(req.query.n) || 100, req.query.filter || null)));
app.get('/sovereignty/integrity', (req, res) => res.json(sovereignty.checkIntegrity()));
app.get('/sovereignty/resources', (req, res) => res.json(sovereignty.checkResourceUsage()));
// POST routes protégées (actions critiques)
app.post('/sovereignty/kill', requireRemoteAuth, (req, res) => { sovereignty.killSwitch('api', req.body?.emergency || false); res.json({ success: true }); });
app.post('/sovereignty/reset', requireRemoteAuth, (req, res) => res.json(sovereignty.resetKillSwitch(true)));
app.post('/sovereignty/consent/grant', requireRemoteAuth, (req, res) => { if (!req.body.permission) return res.status(400).json({error:'permission required'}); sovereignty.grantConsent(req.body.permission, (req.body.durationMin||60)*60000); res.json({success:true}); });
app.post('/sovereignty/consent/revoke', requireRemoteAuth, (req, res) => { req.body.permission ? sovereignty.revokeConsent(req.body.permission) : sovereignty.revokeAllConsents(); res.json({success:true}); });
app.post('/sovereignty/simulate', (req, res) => { if (!req.body.command) return res.status(400).json({error:'command required'}); res.json(sovereignty.checkCommand(req.body.command)); });
app.post('/sovereignty/baseline/rebuild', requireRemoteAuth, (req, res) => {
  if (req.body.confirm !== 'REBUILD_CONFIRMED') return res.status(400).json({ error: 'Confirmation requise', required: 'confirm: "REBUILD_CONFIRMED"' });
  try {
    const baseline = sovereignty.rebuildBaseline();
    sovereignty.auditLog('INFO', 'baseline_rebuild', 'Baseline reconstruite', 'SENSITIVE');
    res.json({ success: true, files: Object.keys(baseline), timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === Tree of Thoughts Routes ===
app.post('/think/deep', async (req, res) => { if (!req.body.message) return res.status(400).json({error:'message required'}); try { if (!treeOfThoughts) return res.status(503).json({error:'module unavailable'}); res.json(await treeOfThoughts.thinkInTrees(req.body.message, req.body.context, { showTree: req.body.showTree })); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/think/last-tree', (req, res) => { if (!treeOfThoughts) return res.status(503).json({error:'unavailable'}); res.json(treeOfThoughts.getLastTree() || { tree: null }); });

// === Adversarial Critic Routes ===
app.post('/critic/analyze', (req, res) => { if (!adversarialCritic) return res.status(503).json({error:'unavailable'}); if (!req.body.question || !req.body.answer) return res.status(400).json({error:'question and answer required'}); res.json(adversarialCritic.analyzeResponse(req.body.answer, req.body.question)); });
app.get('/critic/stats', (req, res) => { if (!adversarialCritic) return res.status(503).json({error:'unavailable'}); res.json(adversarialCritic.getStats()); });

// === Sensory Memory Routes ===
app.get('/sensory/patterns', (req, res) => { if (!sensoryMemory) return res.status(503).json({error:'unavailable'}); res.json(sensoryMemory.getPatterns()); });
app.get('/sensory/predictions', (req, res) => { if (!sensoryMemory) return res.status(503).json({error:'unavailable'}); res.json(sensoryMemory.getPredictions()); });
app.get('/sensory/status', (req, res) => { if (!sensoryMemory) return res.status(503).json({error:'unavailable'}); res.json(sensoryMemory.getStatus()); });
app.post('/sensory/config', requireRemoteAuth, (req, res) => { if (!sensoryMemory) return res.status(503).json({error:'unavailable'}); res.json(sensoryMemory.updateConfig(req.body)); });
app.post('/sensory/pause', requireRemoteAuth, (req, res) => { if (!sensoryMemory) return res.status(503).json({error:'unavailable'}); sensoryMemory.stop(); res.json({paused:true}); });

// === Task Compiler Routes ===
app.post('/tasks/compile', requireRemoteAuth, async (req, res) => { if (!taskCompiler) return res.status(503).json({error:'unavailable'}); if (!req.body.instruction) return res.status(400).json({error:'instruction required'}); try { res.json(await taskCompiler.compileTask(req.body.instruction)); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/tasks/confirm', requireRemoteAuth, (req, res) => { if (!taskCompiler) return res.status(503).json({error:'unavailable'}); res.json(taskCompiler.confirmTask(req.body.taskId)); });
app.get('/tasks/list', (req, res) => { if (!taskCompiler) return res.status(503).json({error:'unavailable'}); res.json(taskCompiler.listTasks()); });
app.delete('/tasks/:id', requireRemoteAuth, (req, res) => { if (!taskCompiler) return res.status(503).json({error:'unavailable'}); res.json(taskCompiler.cancelTask(req.params.id)); });
app.get('/tasks/history', (req, res) => { if (!taskCompiler) return res.status(503).json({error:'unavailable'}); res.json(taskCompiler.getHistory()); });

// === Self Awareness Routes ===
app.get('/self/state', (req, res) => { if (!selfAwareness) return res.status(503).json({error:'unavailable'}); res.json(selfAwareness.getState()); });
app.get('/self/metrics', (req, res) => { if (!selfAwareness) return res.status(503).json({error:'unavailable'}); res.json(selfAwareness.getMetrics(parseInt(req.query.n) || 50)); });

// === Persistent Identity Routes ===
app.get('/identity/state', (req, res) => { if (!persistentIdentity) return res.status(503).json({error:'unavailable'}); res.json(persistentIdentity.getIdentity()); });
app.post('/identity/reset', requireRemoteAuth, (req, res) => { if (!persistentIdentity) return res.status(503).json({error:'unavailable'}); persistentIdentity.resetIdentity(); res.json({success:true}); });

// === P2P Sync Routes ===
app.get('/p2p/status', (req, res) => { if (!p2pSync) return res.status(503).json({error:'unavailable'}); res.json(p2pSync.getStatus()); });
app.get('/p2p/keypair/public', (req, res) => { if (!p2pSync) return res.status(503).json({error:'unavailable'}); res.json({publicKey: p2pSync.getPublicKey()}); });
app.post('/p2p/authorize', requireRemoteAuth, (req, res) => { if (!p2pSync) return res.status(503).json({error:'unavailable'}); if (!req.body.ip || !req.body.publicKey) return res.status(400).json({error:'ip and publicKey required'}); res.json(p2pSync.authorizeNode(req.body.ip, req.body.publicKey)); });
app.post('/p2p/sync/stop', (req, res) => { if (!p2pSync) return res.status(503).json({error:'unavailable'}); res.json({stopped:true}); });

// === Control Center ===
app.get('/control-center', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'control-center.html')));

// ══ EPISODIC MEMORY v11.0 ══
app.get('/episodic/search', async (req, res) => {
  if (!episodicMem) return res.status(503).json({error:'unavailable'});
  if (!req.query.q) return res.status(400).json({error:'q required'});
  try { res.json({ query: req.query.q, results: await episodicMem.searchEpisodes(req.query.q, { n: parseInt(req.query.n) || 5 }) }); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/episodic/stats', async (req, res) => {
  if (!episodicMem) return res.status(503).json({error:'unavailable'});
  try { res.json(await episodicMem.getStats()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/episodic/index', requireRemoteAuth, async (req, res) => {
  if (!episodicMem) return res.status(503).json({error:'unavailable'});
  try { res.json(await episodicMem.indexAllHistory()); } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ AUTO-DOC v11.0 ══
app.get('/autodoc/stats', (req, res) => { if (!autoDoc) return res.status(503).json({error:'unavailable'}); res.json(autoDoc.getStats()); });
app.get('/autodoc/journal', (req, res) => {
  const d = req.query.date || new Date().toISOString().slice(0, 10);
  const file = require('path').join(__dirname, 'knowledge', 'autodoc', `journal-${d}.md`);
  try { const c = require('fs').existsSync(file) ? require('fs').readFileSync(file, 'utf8') : ''; res.json({ date: d, content: c, exists: !!c }); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/autodoc/changelog', (req, res) => {
  const file = require('path').join(__dirname, 'knowledge', 'autodoc', 'CHANGELOG.md');
  try { res.json({ content: require('fs').existsSync(file) ? require('fs').readFileSync(file, 'utf8') : '' }); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/autodoc/weekly', requireRemoteAuth, async (req, res) => {
  if (!autoDoc) return res.status(503).json({error:'unavailable'});
  try { res.json(await autoDoc.generateWeeklySummary()); } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ CAUSAL ENGINE v11.0 ══
app.get('/causal/stats', (req, res) => { if (!causalEngine) return res.status(503).json({error:'unavailable'}); res.json(causalEngine.getStats()); });
app.get('/causal/predictions', async (req, res) => {
  if (!causalEngine) return res.status(503).json({error:'unavailable'});
  try { res.json({ predictions: await causalEngine.generatePredictions() }); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/causal/analyze', async (req, res) => {
  if (!causalEngine) return res.status(503).json({error:'unavailable'});
  if (!req.body.situation) return res.status(400).json({error:'situation required'});
  try { res.json(await causalEngine.analyzeCausality(req.body.situation)); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/causal/graph', requireRemoteAuth, (req, res) => {
  if (!causalEngine) return res.status(503).json({error:'unavailable'});
  const g = causalEngine.causalGraph;
  res.json({ events: g.events.slice(-50), relations: g.relations.slice(-20), patterns: g.patterns, predictions: g.predictions });
});
app.post('/causal/event', requireRemoteAuth, (req, res) => {
  if (!causalEngine) return res.status(503).json({error:'unavailable'});
  try { res.json({ id: causalEngine.addEvent(req.body) }); } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ MAC OPTIMIZER ══
app.get('/optimize/analyze', async (req, res) => {
  if (!macOptimizer) return res.status(503).json({error:'unavailable'});
  try { res.json(await macOptimizer.analyzeSystem()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/optimize/report', requireRemoteAuth, async (req, res) => {
  if (!macOptimizer) return res.status(503).json({error:'unavailable'});
  try { res.json(await macOptimizer.generateOptimizationReport()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/optimize/action', requireRemoteAuth, async (req, res) => {
  if (!macOptimizer) return res.status(503).json({error:'unavailable'});
  const { action, dryRun = true } = req.body;
  const actions = { clean_cache: ()=>macOptimizer.cleanUserCache({dryRun}), empty_trash: ()=>macOptimizer.emptyTrash({dryRun}), clean_npm: ()=>macOptimizer.cleanNpmCache({dryRun}), clean_brew: ()=>macOptimizer.cleanBrewCache({dryRun}), clean_pm2_logs: ()=>macOptimizer.cleanPM2Logs({dryRun}), optimize_memory: ()=>macOptimizer.optimizeMemory({dryRun}), optimize_prometheus: ()=>macOptimizer.optimizePrometheus() };
  if (!actions[action]) return res.status(400).json({error:'Unknown action', available: Object.keys(actions)});
  try { res.json(await actions[action]()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/optimize/large-files', requireRemoteAuth, async (req, res) => {
  if (!macOptimizer) return res.status(503).json({error:'unavailable'});
  try { res.json(await macOptimizer.findLargeFiles(parseFloat(req.query.minGB) || 0.5)); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/optimize/startup', requireRemoteAuth, async (req, res) => {
  if (!macOptimizer) return res.status(503).json({error:'unavailable'});
  try { res.json(await macOptimizer.analyzeStartupItems()); } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ iCLOUD MANAGER ══
app.get('/icloud/status', (req, res) => { if (!icloudMgr) return res.status(503).json({error:'unavailable'}); res.json(icloudMgr.getICloudStats()); });
app.post('/icloud/backup', requireRemoteAuth, async (req, res) => {
  if (!icloudMgr) return res.status(503).json({error:'unavailable'});
  try { res.json(await icloudMgr.backupToICloud()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/icloud/sync/knowledge', requireRemoteAuth, async (req, res) => {
  if (!icloudMgr) return res.status(503).json({error:'unavailable'});
  try { res.json(await icloudMgr.syncKnowledgeToICloud()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/icloud/sync/docs', requireRemoteAuth, async (req, res) => {
  if (!icloudMgr) return res.status(503).json({error:'unavailable'});
  try { res.json(await icloudMgr.syncDocsToICloud()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/icloud/optimize', requireRemoteAuth, async (req, res) => {
  if (!icloudMgr) return res.status(503).json({error:'unavailable'});
  try { res.json(await icloudMgr.optimizeWithICloud()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/icloud/offload', requireRemoteAuth, async (req, res) => {
  if (!icloudMgr) return res.status(503).json({error:'unavailable'});
  if (!req.body.filePath) return res.status(400).json({error:'filePath required'});
  try { res.json(await icloudMgr.offloadToICloud(req.body.filePath, { dryRun: req.body.dryRun !== false })); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ══ MAC CONTROL ══
app.get('/mac/app/list', (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json({ apps: macCtrl.listRunningApps() }); });
app.post('/mac/app/launch', requireRemoteAuth, (req, res) => { if (!macCtrl||!req.body.app) return res.status(400).json({error:'app required'}); res.json(macCtrl.launchApp(req.body.app)); });
app.post('/mac/app/quit', requireRemoteAuth, (req, res) => { if (!macCtrl||!req.body.app) return res.status(400).json({error:'app required'}); res.json(macCtrl.quitApp(req.body.app)); });
app.post('/mac/notify', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.sendNotification(req.body.title, req.body.message, req.body.subtitle)); });
app.get('/mac/network', (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.getNetworkInfo()); });
app.get('/mac/finder/desktop', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json({ files: macCtrl.getDesktopFiles() }); });
app.get('/mac/finder/downloads', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json({ files: macCtrl.getDownloadsFiles() }); });
app.get('/mac/music/status', (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.getMusicStatus()); });
app.post('/mac/music/control', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.controlMusic(req.body.action)); });
app.get('/mac/spotify/status', (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.getSpotifyStatus()); });
app.post('/mac/spotify/control', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.controlSpotify(req.body.action)); });
app.post('/mac/window/focus', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json(macCtrl.focusApp(req.body.app)); });
app.get('/mac/calendar/events', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json({ events: macCtrl.getCalendarEvents(parseInt(req.query.days)||7) }); });
app.get('/mac/reminders', requireRemoteAuth, (req, res) => { if (!macCtrl) return res.status(503).json({error:'unavailable'}); res.json({ reminders: macCtrl.getReminders() }); });
app.post('/mac/reminders/add', requireRemoteAuth, (req, res) => { if (!macCtrl||!req.body.title) return res.status(400).json({error:'title required'}); res.json(macCtrl.addReminder(req.body.title)); });
app.get('/mac/contacts/search', requireRemoteAuth, (req, res) => { if (!macCtrl||!req.query.q) return res.status(400).json({error:'q required'}); res.json({ contacts: macCtrl.searchContacts(req.query.q) }); });

// ══ CLAUDE CODE BRIDGE ══
app.post('/cc/run', requireRemoteAuth, async (req, res) => {
  if (!ccBridge||!req.body.instruction) return res.status(400).json({error:'instruction required'});
  try { sovereignty.auditLog('INFO','claude_code_run',req.body.instruction.slice(0,100),'SENSITIVE'); res.json(await ccBridge.runClaudeCode(req.body.instruction, { cwd: req.body.cwd })); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ══ EMAIL MANAGER ══
app.get('/email/unread', requireRemoteAuth, (req, res) => { if (!emailMgr) return res.status(503).json({error:'unavailable'}); res.json({ emails: emailMgr.getUnreadEmails(parseInt(req.query.max)||10) }); });
app.post('/email/draft/generate', requireRemoteAuth, async (req, res) => {
  if (!emailMgr||!req.body.email) return res.status(400).json({error:'email required'});
  try { const draft = await emailMgr.generateDraft(req.body.email, req.body.context); const saved = emailMgr.saveDraft(req.body.email, draft); res.json({ draft, id: saved.id }); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/email/drafts', requireRemoteAuth, (req, res) => { if (!emailMgr) return res.status(503).json({error:'unavailable'}); res.json({ drafts: emailMgr.getDrafts(req.query.status||'pending') }); });
app.post('/email/send', requireRemoteAuth, (req, res) => {
  if (!emailMgr||!req.body.id) return res.status(400).json({error:'id required'});
  const drafts = emailMgr.getDrafts('pending'); const d = drafts.find(x=>x.id===req.body.id);
  if (!d) return res.status(404).json({error:'Draft not found'});
  const r = emailMgr.sendEmail(d.email.from, 'Re: '+d.email.subject, d.draft);
  if (r.success) emailMgr.updateDraftStatus(req.body.id, 'sent');
  res.json(r);
});

// ══ DESIGN GENERATOR ══
app.post('/design/generate', requireRemoteAuth, async (req, res) => {
  if (!designGen||!req.body.description) return res.status(400).json({error:'description required'});
  try { const r = await designGen.generateDesign(req.body.description, { type: req.body.type, name: req.body.name });
    if (r.pngPath) { const fs = require('fs'); r.pngBase64 = fs.readFileSync(r.pngPath).toString('base64'); }
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/design/list', requireRemoteAuth, async (req, res) => { if (!designGen) return res.status(503).json({error:'unavailable'}); res.json({ designs: await designGen.listDesigns() }); });

// ══ HF IMAGE GENERATION ══
app.post('/image/generate', requireRemoteAuth, async (req, res) => {
  if (!hfImage||!req.body.prompt) return res.status(400).json({error:'prompt required'});
  try {
    const finalPrompt = req.body.enhance !== false ? await hfImage.enhancePrompt(req.body.prompt, req.body.type) : req.body.prompt;
    const result = await hfImage.generate(finalPrompt, { type: req.body.type });
    if (result.error) return res.status(500).json(result);
    const png = require('fs').readFileSync(result.path);
    try { require('fs').unlinkSync(result.path); } catch(e) {}
    res.json({ success: true, image: png.toString('base64'), prompt: finalPrompt, originalPrompt: req.body.prompt, model: result.model });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ WEB DEPLOYER ══
app.get('/vps/servers', requireRemoteAuth, (req, res) => { if (!webDeploy) return res.status(503).json({error:'unavailable'}); res.json({ servers: webDeploy.getSSHServers() }); });
app.post('/vps/site/create', requireRemoteAuth, async (req, res) => { if (!webDeploy||!req.body.description) return res.status(400).json({error:'description required'}); try { res.json(await webDeploy.createSite(req.body.description, { name: req.body.name })); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/vps/site/deploy', requireRemoteAuth, async (req, res) => { if (!webDeploy||!req.body.projectId||!req.body.sshAlias) return res.status(400).json({error:'projectId + sshAlias required'}); try { res.json(await webDeploy.deploySite(req.body.projectId, req.body.sshAlias, { domain: req.body.domain })); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/vps/site/correct', requireRemoteAuth, async (req, res) => { if (!webDeploy||!req.body.projectId) return res.status(400).json({error:'projectId required'}); try { res.json(await webDeploy.applyCorrections(req.body.projectId, req.body.image, req.body.feedback)); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/vps/sites', requireRemoteAuth, (req, res) => { if (!webDeploy) return res.status(503).json({error:'unavailable'}); res.json({ sites: webDeploy.listProjects() }); });

module.exports = { app, server, wss, getInstances, getAutoMode };

if (require.main === module) {
  const PORT = 7777;
  server.listen(PORT, async () => {
    try { require('./logo').printLogo(); } catch {}
    const omegaStatus = require('./omega-brain').getStatus();
    watchdog.startHealthChecks(PORT);
    notify({ title: '\uD83D\uDD25 PROMETHEUS v10.0', message: `Intelligence Autonome :${PORT}`, sound: 'startup' });
    // Warm up Claude CLI in background
    require('./claude-api-bridge').callFast('OK').then(() => console.log('  \u2728 Claude CLI warmed up')).catch(() => {});
    setTimeout(() => { try { if (vectorMem) { vectorMem.indexExistingHistory(); console.log('[Vector] History indexed'); } } catch(e) {} }, 10000);
    try { backupMgr.startScheduler(); } catch(e) {}
    try { if (temporalDaemon) temporalDaemon.start(); } catch(e) {}
    try { if (sensoryMemory) sensoryMemory.start(); } catch(e) {}
    // Keep CLI session alive every 30min
    setInterval(async () => {
      try { await require('./claude-api-bridge').callFast('ping', { maxTokens: 5, timeout: 15000 }); console.log('[CLI] Session maintenue'); } catch(e) {}
    }, 30 * 60 * 1000).unref();
    try {
      const open = (await import('open')).default;
      setTimeout(() => open(`http://localhost:${PORT}`), 800);
    } catch {}

    // ── PM2 Watcher — restart auto + alerte Telegram ──
    const REQUIRED_SERVICES = ['claude-relay', 'cloudflared', 'chroma-server', 'hermes'];
    setInterval(() => {
      try {
        const st = require('child_process').execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        const procs = JSON.parse(st);
        REQUIRED_SERVICES.forEach(name => {
          const p = procs.find(x => x.name === name);
          if (!p || p.pm2_env?.status !== 'online') {
            try { require('child_process').execSync(`pm2 restart ${name} 2>/dev/null`, { timeout: 10000 }); console.log(`[PM2Watch] ${name} redémarré`); if (global.sendHermesAlert) global.sendHermesAlert('WARN', `Service redémarré: ${name}`, `${name} était offline — redémarré auto`); }
            catch (e) { if (global.sendHermesAlert) global.sendHermesAlert('CRITICAL', `Service KO: ${name}`, `${name} offline — restart échoué`); }
          }
        });
      } catch (e) {}
    }, 300000).unref();

    // ── Sovereignty baseline auto-rebuild au boot ──
    setTimeout(() => {
      try { const integ = sovereignty.checkIntegrity(); if (!integ.ok) { console.log('[Sovereignty] Violations boot — rebuild...'); sovereignty.rebuildBaseline(); console.log('[Sovereignty] Baseline reconstruite'); } }
      catch (e) {}
    }, 10000).unref();

    // ── Rapport routing Llama/Claude horaire + alerte 20h ──
    setInterval(() => {
      try {
        const router = require('./model-router');
        const stats = router.getStats();
        if (stats.total > 0) console.log(`[Router] Total:${stats.total} Llama:${stats.llamaCalls}(${stats.llamaPct}%) Claude:${stats.claudeCalls} Savings:${stats.estimatedSavings}`);
        const h = new Date().getHours(), m = new Date().getMinutes();
        if (h === 20 && m < 5 && global.sendHermesAlert && stats.total > 0)
          global.sendHermesAlert('INFO', 'Rapport routing', `Llama: ${stats.llamaCalls} (${stats.llamaPct}%)\nClaude: ${stats.claudeCalls}\nSavings: ${stats.estimatedSavings}`);
      } catch (e) {}
    }, 300000).unref();

    // ── iCloud vérification boot + backup dimanche 3h ──
    setTimeout(async () => {
      try { const ic = require('./icloud-manager'); const s = ic.getICloudStats(); console.log('[iCloud]', s.available ? 'OK — ' + s.prometheusSize : 'Non disponible'); if (s.available) ic.initICloudStructure(); }
      catch (e) {}
    }, 8000).unref();
    setInterval(async () => {
      try {
        const now = new Date();
        if (now.getDay() === 0 && now.getHours() === 3 && now.getMinutes() < 5) {
          const ic = require('./icloud-manager');
          const r = await ic.backupToICloud();
          if (global.sendHermesAlert) global.sendHermesAlert(r.success ? 'SUCCESS' : 'WARN', r.success ? 'Backup iCloud OK' : 'Backup échoué', r.success ? `${r.files?.filter(f=>f.ok).length} fichiers` : r.reason || 'Erreur');
        }
      } catch (e) {}
    }, 300000).unref();
  });
}
