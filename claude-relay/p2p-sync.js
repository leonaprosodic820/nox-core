'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_PATH = path.join(__dirname, 'knowledge', 'p2p-config.json');

// Files that must NEVER be synced
const NEVER_SYNC = [
  'chat-history', 'config.json', 'logs', '.env', 'sessions',
  'node_modules', '.git', 'package-lock.json', 'ecosystem.config.js',
  'coverage', '.DS_Store'
];

// File patterns allowed for sync
const SYNCABLE_PATTERNS = [
  'knowledge/*.json',
  'missions/*.json',
  'decisions/*.json',
  'projects/*.json'
];

let config = null;

function ensureStorage() {
  try {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  } catch (e) { /* ignore */ }
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    config = JSON.parse(raw);
  } catch (e) {
    config = createDefault();
  }
}

function createDefault() {
  return {
    version: '1.0.0',
    active: false,
    keyPair: null,
    authorizedNodes: [],
    lastSync: null,
    createdAt: new Date().toISOString()
  };
}

function saveConfig() {
  try {
    ensureStorage();
    // Never store private key to disk - only public key and node list
    const toSave = {
      ...config,
      keyPair: config.keyPair ? { publicKey: config.keyPair.publicKey } : null
    };
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(toSave, null, 2));
  } catch (e) { /* ignore */ }
}

function generateKeyPair() {
  if (!config) loadConfig();

  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    config.keyPair = { publicKey, privateKey };
    saveConfig(); // private key stays in memory only
    return { publicKey, generated: true };
  } catch (err) {
    return { error: err.message };
  }
}

function getPublicKey() {
  if (!config) loadConfig();
  return config.keyPair ? config.keyPair.publicKey : null;
}

function getStatus() {
  if (!config) loadConfig();
  return {
    active: config.active || false,
    nodes: config.authorizedNodes.map(n => ({ ip: n.ip, addedAt: n.addedAt })),
    lastSync: config.lastSync,
    hasKeyPair: !!config.keyPair
  };
}

function authorizeNode(ip, publicKey) {
  if (!config) loadConfig();

  if (!ip || typeof ip !== 'string') {
    return { error: 'IP address required' };
  }
  if (!publicKey || typeof publicKey !== 'string') {
    return { error: 'Public key required' };
  }

  // Validate IP format (basic)
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;
  if (!ipRegex.test(ip)) {
    return { error: 'Invalid IP address format' };
  }

  // Check if already authorized
  const existing = config.authorizedNodes.find(n => n.ip === ip);
  if (existing) {
    return { error: 'Node already authorized', ip };
  }

  // Max 10 nodes
  if (config.authorizedNodes.length >= 10) {
    return { error: 'Maximum 10 authorized nodes reached' };
  }

  config.authorizedNodes.push({
    ip,
    publicKey,
    addedAt: new Date().toISOString()
  });

  saveConfig();
  return { authorized: true, ip, totalNodes: config.authorizedNodes.length };
}

function getSyncableFiles() {
  if (!config) loadConfig();

  const baseDir = path.join(__dirname);
  const syncable = [];

  for (const pattern of SYNCABLE_PATTERNS) {
    const parts = pattern.split('/');
    const dir = parts[0];
    const ext = parts[1] ? parts[1].replace('*', '') : '';
    const fullDir = path.join(baseDir, dir);

    try {
      if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
        const files = fs.readdirSync(fullDir);
        for (const file of files) {
          if (ext && !file.endsWith(ext)) continue;
          if (NEVER_SYNC.includes(file)) continue;

          const filePath = path.join(dir, file);
          const stat = fs.statSync(path.join(fullDir, file));
          syncable.push({
            path: filePath,
            size: stat.size,
            modified: stat.mtime.toISOString()
          });
        }
      }
    } catch (e) { /* skip unreadable dirs */ }
  }

  return syncable;
}

// Load on require
loadConfig();

module.exports = { generateKeyPair, getPublicKey, getStatus, authorizeNode, getSyncableFiles };
