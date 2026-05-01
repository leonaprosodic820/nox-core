const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SECURITY_LOG = path.join(__dirname, 'logs', 'security.log');
const BLOCKED_IPS = new Set();
const SUSPICIOUS_IPS = new Map();
const ACTIVE_TOKENS = new Map();

async function hashPin(pin) {
  const bcrypt = require('bcrypt');
  return bcrypt.hash(String(pin), 15);
}

async function verifyPin(pin, hash) {
  const bcrypt = require('bcrypt');
  return bcrypt.compare(String(pin), hash);
}

function detectAttack(ip, requestType) {
  const now = Date.now();
  const record = SUSPICIOUS_IPS.get(ip) || { count: 0, firstSeen: now, requests: [] };
  record.requests.push(now);
  record.requests = record.requests.filter(t => now - t < 60000);
  record.count = record.requests.length;
  SUSPICIOUS_IPS.set(ip, record);

  const patterns = {
    bruteForce: record.count > 20 && requestType === 'login',
    ddos: record.count > 100,
    scanning: record.count > 50 && requestType === 'unknown',
    rapidfire: record.requests.filter(t => now - t < 1000).length > 10
  };

  const isAttack = Object.values(patterns).some(Boolean);
  if (isAttack) {
    BLOCKED_IPS.add(ip);
    logSecurity('ATTACK_DETECTED', ip, JSON.stringify(patterns));
    try { execSync(`osascript -e 'display notification "Attack from ${ip}" with title "PROMETHEUS Security" sound name "Basso"'`); } catch {}
  }

  return { isAttack, patterns, requestCount: record.count };
}

function generateSessionKey() { return crypto.randomBytes(32).toString('hex'); }

function encryptPayload(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex').slice(0, 32), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('hex'), data: encrypted.toString('hex'), tag: tag.toString('hex') };
}

function decryptPayload(encrypted, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex').slice(0, 32), Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'hex')), decipher.final()]).toString('utf8'));
}

function generate2FASecret() {
  const speakeasy = require('speakeasy');
  const secret = speakeasy.generateSecret({ name: 'PROMETHEUS', length: 32 });
  return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
}

function verify2FA(token, secret) {
  const speakeasy = require('speakeasy');
  return speakeasy.totp.verify({ secret, encoding: 'base32', token: String(token), window: 2 });
}

async function generateQRCode(otpauthUrl) {
  const qrcode = require('qrcode');
  return qrcode.toDataURL(otpauthUrl);
}

function logSecurity(event, ip, detail = '') {
  try { fs.appendFileSync(SECURITY_LOG, `${new Date().toISOString()} [${event}] IP:${ip} | ${detail}\n`); } catch {}
}

function getSecurityReport() {
  return {
    blockedIPs: Array.from(BLOCKED_IPS),
    suspiciousIPs: Array.from(SUSPICIOUS_IPS.entries()).filter(([,v]) => v.count > 10).map(([ip,v]) => ({ ip, requestCount: v.count })),
    activeTokens: ACTIVE_TOKENS.size,
    totalEvents: (() => { try { return fs.readFileSync(SECURITY_LOG,'utf8').split('\n').filter(Boolean).length; } catch { return 0; } })()
  };
}

module.exports = { hashPin, verifyPin, detectAttack, generateSessionKey, encryptPayload, decryptPayload, generate2FASecret, verify2FA, generateQRCode, logSecurity, getSecurityReport, BLOCKED_IPS, SUSPICIOUS_IPS, ACTIVE_TOKENS };
