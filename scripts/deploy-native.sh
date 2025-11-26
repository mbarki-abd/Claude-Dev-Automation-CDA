#!/bin/bash
# Deployment script for native installation
# Run this to deploy updates

set -e

cd /root/CDA

echo "=== CDA Native Deployment ==="
echo ""

# Pull latest code
echo "[1/6] Pulling latest code..."
git pull origin main

# Install dependencies
echo "[2/6] Installing dependencies..."
pnpm install

# Build shared package
echo "[3/6] Building shared package..."
pnpm --filter @cda/shared build

# Build API
echo "[4/6] Building API..."
pnpm --filter @cda/api build

# Build Dashboard
echo "[5/6] Building Dashboard..."
pnpm --filter @cda/dashboard build

# Reload PM2
echo "[6/6] Reloading API..."
pm2 reload cda-api --update-env 2>/dev/null || pm2 start ecosystem.config.cjs

# Copy dashboard
echo "Copying dashboard..."
cp -r apps/dashboard/dist/* /usr/share/nginx/html/

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Services:"
echo "- API: pm2 status"
echo "- Dashboard: https://cda.ilinqsoft.com"
echo "- Logs: pm2 logs cda-api"
echo ""
