const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { notify } = require('./notifier');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOGS_DIR = path.join(__dirname, 'logs');

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}

const tokenBlacklist = new Set();
const loginAttempts = new Map();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const remoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Rate limit exceeded' }
});

let configManuallySet = false;
function reloadConfig() {
  if (configManuallySet) return;
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  if (req.cookies && req.cookies.relay_token) return req.cookies.relay_token;
  if (req.query && req.query.token) return req.query.token;
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  if (tokenBlacklist.has(token)) return res.status(401).json({ error: 'Token revoked' });

  try {
    const secret = config.jwtSecret || 'default-secret-change-me';
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function handleLogin(req, res) {
  reloadConfig();
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // Check lockout
  const attempts = loginAttempts.get(ip);
  if (attempts && attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    const remaining = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `IP locked for ${remaining}s` });
  }

  // Verify PIN
  const pinHash = config.pinHash;
  if (!pinHash) return res.status(500).json({ error: 'Server not configured - run generate-config.js first' });

  const valid = await bcrypt.compare(String(pin), pinHash);
  if (!valid) {
    const current = loginAttempts.get(ip) || { count: 0 };
    current.count++;
    if (current.count >= (config.maxLoginAttempts || 3)) {
      current.lockedUntil = Date.now() + (config.lockoutDurationSec || 1800) * 1000;
      notify({ message: `⚠️ IP ${ip} locked after ${current.count} failed login attempts`, sound: 'error' });
    }
    loginAttempts.set(ip, current);
    logAccess(ip, 'LOGIN_FAILED');
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  // Success PIN — vérifier 2FA si activé
  try {
    const cfg = require('./config.json');
    if (cfg.twoFAEnabled && cfg.twoFASecret) {
      const totpToken = req.body.totp || req.body.token2fa || req.headers['x-totp-token'];
      if (!totpToken) {
        return res.status(401).json({ error: '2FA requis', require2FA: true });
      }
      const totpAuth = require('./totp-auth');
      if (!totpAuth.verifyToken(totpToken, cfg.twoFASecret)) {
        logAccess(ip, '2FA_FAILED');
        return res.status(401).json({ error: 'Code 2FA invalide' });
      }
      logAccess(ip, '2FA_SUCCESS');
    }
  } catch (e) {}

  loginAttempts.delete(ip);
  const secret = config.jwtSecret || 'default-secret-change-me';
  const token = jwt.sign({ ip, role: 'remote', iat: Math.floor(Date.now() / 1000) }, secret, { expiresIn: config.sessionTimeout || 86400 });

  res.cookie('relay_token', token, {
    httpOnly: true, secure: true, sameSite: 'Strict',
    maxAge: (config.sessionTimeout || 86400) * 1000
  });

  logAccess(ip, 'LOGIN_SUCCESS');
  notify({ message: `⚡ Remote login from ${ip}`, sound: 'info' });
  res.json({ success: true, token });
}

function handleLogout(req, res) {
  const token = extractToken(req);
  if (token) tokenBlacklist.add(token);
  res.clearCookie('relay_token');
  logAccess(req.ip, 'LOGOUT');
  res.json({ success: true });
}

function logAccess(ip, event) {
  try {
    const line = `[${new Date().toISOString()}] [${event}] ${ip}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, 'access.log'), line);
  } catch {}
}

// For testing: allow setting config directly
function setConfig(newConfig) { config = newConfig; configManuallySet = true; }
function getConfig() { return config; }

module.exports = { requireAuth, loginLimiter, remoteLimiter, handleLogin, handleLogout, extractToken, setConfig, getConfig, tokenBlacklist, loginAttempts };
