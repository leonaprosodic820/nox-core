'use strict';
/**
 * PROMETHEUS Knowledge Graph v9.0
 * JSON graph natif — nœuds + relations typées + traversée
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRAPH_FILE = path.join(__dirname, 'knowledge', 'graph.json');
fs.mkdirSync(path.dirname(GRAPH_FILE), { recursive: true });

let graph = { nodes: [], edges: [], lastUpdated: null };

function load() { try { if (fs.existsSync(GRAPH_FILE)) graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8')); } catch (e) {} }
function save() { graph.lastUpdated = new Date().toISOString(); try { fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2)); } catch (e) {} }
load();

const TYPES = ['Person', 'Project', 'Technology', 'Concept', 'Decision', 'Bug', 'Solution', 'URL', 'File', 'Service'];
const RELATIONS = ['UTILISE', 'RESOUT', 'CONNECTE_A', 'DEPEND_DE', 'A_CAUSE', 'MENE_A', 'CONTIENT', 'APPARTIENT_A', 'CREE_PAR', 'REFERENCE'];

function genId() { return crypto.randomBytes(6).toString('hex'); }

function addNode(label, type, properties = {}) {
  if (!TYPES.includes(type)) type = 'Concept';
  const existing = graph.nodes.find(n => n.label.toLowerCase() === label.toLowerCase() && n.type === type);
  if (existing) { Object.assign(existing.properties, properties); existing.updatedAt = new Date().toISOString(); save(); return existing; }
  const node = { id: genId(), label, type, properties, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  graph.nodes.push(node);
  save();
  return node;
}

function addRelation(fromId, toId, relation, properties = {}) {
  if (!RELATIONS.includes(relation)) relation = 'CONNECTE_A';
  const from = graph.nodes.find(n => n.id === fromId);
  const to = graph.nodes.find(n => n.id === toId);
  if (!from || !to) return { error: 'Node not found' };
  const existing = graph.edges.find(e => e.from === fromId && e.to === toId && e.relation === relation);
  if (existing) return existing;
  const edge = { id: genId(), from: fromId, to: toId, relation, properties, createdAt: new Date().toISOString() };
  graph.edges.push(edge);
  save();
  return edge;
}

function findNode(query) {
  const q = query.toLowerCase();
  return graph.nodes.filter(n => n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || JSON.stringify(n.properties).toLowerCase().includes(q)).slice(0, 20);
}

function getRelated(nodeId, depth = 1) {
  const visited = new Set();
  const results = [];

  function traverse(id, d) {
    if (d > depth || visited.has(id)) return;
    visited.add(id);
    const outEdges = graph.edges.filter(e => e.from === id);
    const inEdges = graph.edges.filter(e => e.to === id);
    [...outEdges, ...inEdges].forEach(e => {
      const otherId = e.from === id ? e.to : e.from;
      const other = graph.nodes.find(n => n.id === otherId);
      if (other) {
        results.push({ node: other, relation: e.relation, direction: e.from === id ? 'out' : 'in', edge: e });
        traverse(otherId, d + 1);
      }
    });
  }

  traverse(nodeId, 0);
  return results;
}

function getNodesByType(type) { return graph.nodes.filter(n => n.type === type); }

// Extraction automatique depuis une conversation
function extractFromConversation(userMsg, assistantMsg) {
  const combined = userMsg + ' ' + assistantMsg;
  const extracted = [];

  // Technologies
  const techRx = /\b(React|Vue|Angular|Node\.?js|Python|Docker|Kubernetes|PostgreSQL|MongoDB|Redis|Express|Next\.?js|TypeScript|JavaScript|Rust|Go|Swift|Cloudflare|Vercel|PM2|Nginx|Git|GitHub)\b/gi;
  const techs = [...new Set([...combined.matchAll(techRx)].map(m => m[1]))];
  techs.forEach(t => {
    const node = addNode(t, 'Technology');
    extracted.push(node);
  });

  // Projets mentionnés
  const projRx = /\b(PROMETHEUS|ShadowVault|ShadowNotes|ShadowPasswords|Nox\s*Core|claude-relay|Citadel|OmniXAI)\b/gi;
  const projs = [...new Set([...combined.matchAll(projRx)].map(m => m[1]))];
  projs.forEach(p => {
    const node = addNode(p, 'Project');
    extracted.push(node);
    // Relier les techs aux projets
    techs.forEach(t => {
      const techNode = graph.nodes.find(n => n.label.toLowerCase() === t.toLowerCase());
      if (techNode) addRelation(node.id, techNode.id, 'UTILISE');
    });
  });

  // Bugs/Erreurs
  if (/erreur|error|bug|problème|crash|fail/i.test(userMsg)) {
    const bugNode = addNode(userMsg.slice(0, 80), 'Bug', { resolved: /résolu|fixed|corrigé/i.test(assistantMsg) });
    extracted.push(bugNode);
    if (/résolu|fixed|corrigé/i.test(assistantMsg)) {
      const solNode = addNode(assistantMsg.slice(0, 100), 'Solution');
      addRelation(solNode.id, bugNode.id, 'RESOUT');
      extracted.push(solNode);
    }
  }

  // URLs
  const urls = combined.match(/https?:\/\/[^\s"'<>]+/g) || [];
  urls.slice(0, 5).forEach(u => { extracted.push(addNode(u, 'URL', { url: u })); });

  if (extracted.length > 0) save();
  return extracted;
}

// D3.js format pour visualisation
function toD3() {
  return {
    nodes: graph.nodes.map(n => ({ id: n.id, label: n.label, type: n.type, group: TYPES.indexOf(n.type) })),
    links: graph.edges.map(e => ({ source: e.from, target: e.to, relation: e.relation, id: e.id })),
  };
}

function getStats() {
  const byType = {};
  graph.nodes.forEach(n => { byType[n.type] = (byType[n.type] || 0) + 1; });
  const byRelation = {};
  graph.edges.forEach(e => { byRelation[e.relation] = (byRelation[e.relation] || 0) + 1; });
  return { nodes: graph.nodes.length, edges: graph.edges.length, byType, byRelation, lastUpdated: graph.lastUpdated };
}

function removeNode(id) {
  graph.nodes = graph.nodes.filter(n => n.id !== id);
  graph.edges = graph.edges.filter(e => e.from !== id && e.to !== id);
  save();
}

module.exports = { addNode, addRelation, findNode, getRelated, getNodesByType, extractFromConversation, toD3, getStats, removeNode, TYPES, RELATIONS };
