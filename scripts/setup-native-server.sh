#!/bin/bash
# Setup script for native deployment on Hetzner server
# Run this once to prepare the server

set -e

echo "=== CDA Native Deployment Setup ==="
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root"
   exit 1
fi

# Update system
echo "[1/7] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# Install Node.js 20
echo "[2/7] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
node --version

# Enable corepack and install pnpm
echo "[3/7] Installing pnpm..."
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version

# Install PM2 globally
echo "[4/7] Installing PM2..."
npm install -g pm2
pm2 --version

# Install Claude CLI
echo "[5/7] Installing Claude CLI..."
npm install -g @anthropic-ai/claude-code
claude --version

# Create workspace directory
echo "[6/7] Creating workspace directory..."
mkdir -p /root/claude-workspace
mkdir -p /root/CDA/logs
chmod 755 /root/claude-workspace

# Setup PM2 startup
echo "[7/7] Configuring PM2 startup..."
pm2 startup systemd -u root --hp /root
pm2 save

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Clone your repository to /root/CDA"
echo "2. Copy .env file with your credentials"
echo "3. Start Docker services: cd /root/CDA/infrastructure && docker compose -f docker-compose.native.yml up -d"
echo "4. Build application: cd /root/CDA && pnpm install && pnpm run build:all"
echo "5. Start API: pm2 start ecosystem.config.js"
echo "6. Copy dashboard: cp -r apps/dashboard/dist/* /usr/share/nginx/html/"
echo ""
