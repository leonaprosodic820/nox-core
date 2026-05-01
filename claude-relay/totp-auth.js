'use strict';
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function getConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function saveConfig(cfg) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); }

function generateSecret(label = 'PROMETHEUS') {
  const secret = speakeasy.generateSecret({ name: label, issuer: 'PROMETHEUS v7.3', length: 20 });
  return { base32: secret.base32, otpauth: secret.otpauth_url, ascii: secret.ascii };
}

async function generateQRCode(otpauthUrl) {
  return await QRCode.toDataURL(otpauthUrl, {
    type: 'image/png', width: 256, margin: 2,
    color: { dark: '#4facfe', light: '#050814' },
  });
}

function verifyToken(token, secret) {
  if (!secret || !token) return false;
  return speakeasy.totp.verify({
    secret, encoding: 'base32',
    token: String(token).replace(/\s/g, ''),
    window: 2,
  });
}

function generateCurrentToken(secret) {
  return speakeasy.totp({ secret, encoding: 'base32' });
}

async function setup2FA() {
  const cfg = getConfig();
  const { base32, otpauth } = generateSecret('PROMETHEUS');
  const qrDataURL = await generateQRCode(otpauth);
  cfg.twoFASecret = base32;
  cfg.twoFAEnabled = false;
  saveConfig(cfg);
  return { secret: base32, otpauth, qrDataURL };
}

function confirm2FA(token) {
  const cfg = getConfig();
  if (!cfg.twoFASecret) return { success: false, error: 'Secret non généré' };
  if (verifyToken(token, cfg.twoFASecret)) {
    cfg.twoFAEnabled = true;
    saveConfig(cfg);
    return { success: true };
  }
  return { success: false, error: 'Code invalide' };
}

function disable2FA(token) {
  const cfg = getConfig();
  if (!verifyToken(token, cfg.twoFASecret)) return { success: false, error: 'Code invalide' };
  cfg.twoFAEnabled = false;
  cfg.twoFASecret = '';
  saveConfig(cfg);
  return { success: true };
}

function is2FAEnabled() {
  try { const cfg = getConfig(); return !!(cfg.twoFAEnabled && cfg.twoFASecret); }
  catch (e) { return false; }
}

module.exports = {
  generateSecret, generateQRCode, verifyToken, generateCurrentToken,
  setup2FA, confirm2FA, disable2FA, is2FAEnabled,
};
