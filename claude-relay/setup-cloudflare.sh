#!/bin/bash
set -e
echo "=== Claude Relay — Cloudflare Tunnel Setup ==="
echo ""

command -v cloudflared &>/dev/null || { echo "Installing cloudflared..."; brew install cloudflared; }

echo "Step 1: Login to Cloudflare..."
cloudflared tunnel login

echo ""
echo "Step 2: Creating tunnel 'claude-relay'..."
TUNNEL_OUT=$(cloudflared tunnel create claude-relay 2>&1) || true
echo "$TUNNEL_OUT"
TUNNEL_ID=$(echo "$TUNNEL_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

if [ -z "$TUNNEL_ID" ]; then
  echo "Tunnel may already exist. Listing..."
  TUNNEL_ID=$(cloudflared tunnel list 2>&1 | grep claude-relay | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
fi

echo "Tunnel ID: $TUNNEL_ID"

echo ""
read -p "Enter full subdomain (e.g., cmd.example.com): " CF_DOMAIN

echo "Step 3: Setting DNS route..."
cloudflared tunnel route dns claude-relay "$CF_DOMAIN" || true

echo "Step 4: Creating config..."
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $CF_DOMAIN
    service: http://localhost:7777
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s
  - service: http_status:404
EOF

echo "Step 5: Updating config.json..."
cd ~/claude-relay
node -e "
  const fs=require('fs');
  let c={}; try{c=JSON.parse(fs.readFileSync('./config.json','utf8'));}catch{}
  c.tunnelId='$TUNNEL_ID';c.cloudflareURL='https://$CF_DOMAIN';c.cloudflareDomain='$CF_DOMAIN';
  fs.writeFileSync('./config.json',JSON.stringify(c,null,2));
  console.log('✅ config.json updated');
"

echo ""
echo "=== Setup Complete ==="
echo "Remote URL: https://$CF_DOMAIN/remote"
echo ""
echo "To start tunnel: cloudflared tunnel run claude-relay"
echo "Or via PM2: pm2 start ecosystem.config.js"
