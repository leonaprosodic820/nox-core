'use strict';
const fs = require('fs');
const path = require('path');
const RL_PATH = path.join(__dirname, 'knowledge', 'rl-state.json');

function load() { try { if (fs.existsSync(RL_PATH)) return JSON.parse(fs.readFileSync(RL_PATH, 'utf8')); } catch(e) {} return { episodes: 0, qTable: {}, rewards: [], policy: {} }; }
function save(state) { state.updatedAt = new Date().toISOString(); fs.mkdirSync(path.dirname(RL_PATH), { recursive: true }); fs.writeFileSync(RL_PATH, JSON.stringify(state, null, 2)); }

const ACTIONS = ['use_llama', 'use_sonnet', 'use_opus_deep', 'search_web_first', 'use_cache'];

function encodeState(message, promptType) {
  return JSON.stringify({ type: promptType || 'chat', length: message.length < 20 ? 'short' : message.length < 100 ? 'medium' : 'long', hasQuestion: message.includes('?'), isTechnical: /code|script|api|bug/i.test(message) });
}

function selectAction(state, epsilon = 0.1) {
  const rl = load();
  if (Math.random() < epsilon) return ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  const qv = rl.qTable[state] || {};
  let best = 'use_sonnet', bestQ = -Infinity;
  for (const a of ACTIONS) { const q = qv[a] || 0; if (q > bestQ) { bestQ = q; best = a; } }
  return best;
}

function updateQValue(state, action, reward, nextState) {
  const rl = load();
  if (!rl.qTable[state]) rl.qTable[state] = {};
  if (!rl.qTable[nextState]) rl.qTable[nextState] = {};
  const currentQ = rl.qTable[state][action] || 0;
  const maxNextQ = Math.max(0, ...ACTIONS.map(a => rl.qTable[nextState][a] || 0));
  rl.qTable[state][action] = Math.round((currentQ + 0.1 * (reward + 0.9 * maxNextQ - currentQ)) * 1000) / 1000;
  rl.episodes++;
  rl.rewards.push({ ts: new Date().toISOString(), action, reward: Math.round(reward * 100) / 100 });
  if (rl.rewards.length > 1000) rl.rewards.shift();
  const bestQ2 = Math.max(0, ...ACTIONS.map(a => rl.qTable[state][a] || 0));
  rl.policy[state] = ACTIONS.find(a => rl.qTable[state][a] === bestQ2) || 'use_sonnet';
  save(rl);
}

function calculateReward(quality, duration, action) {
  let r = quality.score * 2 - 1;
  if (duration < 3000) r += 0.3; if (duration > 15000) r -= 0.3;
  if (action === 'use_llama') r += 0.2; if (action === 'use_cache') r += 0.3;
  if (quality.issues?.includes('réponse en anglais')) r -= 0.5;
  return Math.max(-1, Math.min(1, r));
}

function learn(message, promptType, action, quality, duration) {
  const state = encodeState(message, promptType);
  const reward = calculateReward(quality, duration, action);
  updateQValue(state, action, reward, encodeState('', promptType));
  return { state, action, reward };
}

function recommend(message, promptType) { return selectAction(encodeState(message, promptType), 0.05); }

function getStats() {
  const rl = load();
  const rw = rl.rewards.slice(-100);
  return { episodes: rl.episodes, states: Object.keys(rl.qTable).length, avgReward: rw.length > 0 ? Math.round(rw.reduce((s, r) => s + r.reward, 0) / rw.length * 100) / 100 : 0 };
}

module.exports = { learn, recommend, selectAction, calculateReward, encodeState, getStats };
