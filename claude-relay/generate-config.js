const crypto = require('crypto');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

async function generate() {
  const pin = process.argv[2];
  if (!pin || pin.length < 4) {
    console.error('Usage: node generate-config.js [PIN_4-6_DIGITS]');
    process.exit(1);
  }

  const config = {
    remoteSecret: crypto.randomBytes(32).toString('hex'),
    pinHash: await bcrypt.hash(String(pin), 12),
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    sessionTimeout: 86400,
    maxLoginAttempts: 3,
    lockoutDurationSec: 1800,
    tunnelId: '',
    cloudflareURL: '',
    cloudflareDomain: '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  console.log('✅ config.json generated');
  console.log(`   remoteSecret: ${config.remoteSecret.slice(0, 8)}...`);
  console.log(`   pinHash: ${config.pinHash.slice(0, 10)}...`);
  console.log(`   jwtSecret: ${config.jwtSecret.slice(0, 8)}...`);
  console.log('⚠️  KEEP SECRET — contains all system secrets');
}

generate().catch(console.error);
