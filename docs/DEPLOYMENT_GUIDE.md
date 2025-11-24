# Native Deployment Guide - Using PuTTY/PSCP

This guide walks through deploying the CDA application to Hetzner using PuTTY for SSH and PSCP for file transfer.

## Prerequisites

- PuTTY and PSCP installed (download from https://www.putty.org/)
- Hetzner server: 78.47.138.194
- Root credentials

## Step 1: Create Project Archive

Run this PowerShell script to create a clean archive:

```powershell
cd "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA"

# Create temp directory
$tempDir = "$env:TEMP\cda-deploy"
New-Item -ItemType Directory -Path "$tempDir\cda" -Force

# Copy only necessary files
$items = @("apps", "packages", "infrastructure", "ecosystem.config.cjs", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.json")

foreach ($item in $items) {
    if (Test-Path $item) {
        Copy-Item -Path $item -Destination "$tempDir\cda\" -Recurse -Force -Exclude @('node_modules', 'dist', 'logs', '*.log', 'coverage', 'playwright-report', 'test-results')
    }
}

# Create archive
cd $tempDir
tar -czf cda-project.tar.gz cda

Write-Host "Archive created at: $tempDir\cda-project.tar.gz"
Write-Host "Size: $([math]::Round((Get-Item cda-project.tar.gz).Length / 1MB, 2)) MB"
```

## Step 2: Upload Archive Using PSCP

Open PowerShell and run:

```powershell
cd "$env:TEMP\cda-deploy"

# Upload using PSCP
pscp -pw EubnUUAVJKVF cda-project.tar.gz root@78.47.138.194:/tmp/
```

**Note**: PSCP will show upload progress. The upload should take 30-60 seconds depending on your connection.

## Step 3: Connect with PuTTY

1. Open PuTTY
2. Host Name: `78.47.138.194`
3. Port: `22`
4. Connection type: SSH
5. Click "Open"
6. Login as: `root`
7. Password: `EubnUUAVJKVF`

## Step 4: Clean and Prepare Server

In the PuTTY terminal, run:

```bash
# Stop all Docker containers and PM2 processes
docker stop $(docker ps -aq) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Remove old installation
rm -rf /root/CDA

# Extract uploaded archive
cd /tmp
tar -xzf cda-project.tar.gz
mv cda /root/CDA
rm cda-project.tar.gz

# Verify extraction
ls -la /root/CDA
```

## Step 5: Create Environment File

Create the environment configuration:

```bash
cat > /root/CDA/infrastructure/.env << 'EOF'
# PostgreSQL
POSTGRES_DB=cda
POSTGRES_USER=postgres
POSTGRES_PASSWORD=secure_postgres_password_2024

# API
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:secure_postgres_password_2024@localhost:5432/cda
REDIS_URL=redis://localhost:6379
WORKSPACE_DIR=/root/claude-workspace
CLAUDE_CODE_PATH=claude
ANTHROPIC_API_KEY=sk-ant-api03-0PoQzSNCwPvVkrMfpIo7MhR5FzZs2ZYsH3f2J6lU9uZT5aG7eDNKYP8cD-9l8hGTQIDa5bqHhVNY6MjFElh2cg-KbJ0rwAA
EOF

# Fix nginx config for Linux (replace host.docker.internal)
sed -i 's/host\.docker\.internal:3000/172.17.0.1:3000/g' /root/CDA/infrastructure/nginx.native.conf
```

## Step 6: Start Docker Services

Start PostgreSQL and Redis:

```bash
cd /root/CDA/infrastructure
docker compose -f docker-compose.native.yml up -d postgres redis

# Wait for services to be ready
sleep 10

# Verify services are running
docker ps
```

You should see:
- `cda-postgres` (healthy)
- `cda-redis` (healthy)

## Step 7: Build Application

```bash
cd /root/CDA

# Export environment variables
export $(cat infrastructure/.env | grep -v '^#' | xargs)

# Create workspace directory
mkdir -p /root/claude-workspace

# Install dependencies
pnpm install

# Build packages
pnpm --filter @cda/shared build
pnpm --filter @cda/api build
pnpm --filter @cda/dashboard build
```

**Note**: The build process may take 5-10 minutes. Watch for any errors.

## Step 8: Start API with PM2

```bash
cd /root/CDA

# Export environment variables again
export $(cat infrastructure/.env | grep -v '^#' | xargs)

# Start with PM2
pm2 delete cda-api 2>/dev/null || true
pm2 start ecosystem.config.cjs

# Save PM2 configuration for auto-restart
pm2 save
pm2 startup

# Check status
pm2 status
pm2 logs cda-api --lines 50
```

## Step 9: Start Nginx

```bash
cd /root/CDA/infrastructure
docker compose -f docker-compose.native.yml up -d nginx

# Check all services
docker ps
```

## Step 10: Verification

Test the deployment:

```bash
# Test API health
curl http://localhost:3000/api/health

# Test Dashboard
curl -I https://cda.ilinqsoft.com

# Check PM2 status
pm2 status

# Check Docker services
docker ps
```

Expected results:
- API health should return: `{"status":"healthy",...}`
- Dashboard should return: `HTTP/2 200`
- PM2 should show 2 instances of `cda-api` (cluster mode)
- Docker should show 3 containers: postgres, redis, nginx

## Monitoring

```bash
# PM2 logs
pm2 logs cda-api

# PM2 monitoring
pm2 monit

# Docker logs
docker logs cda-postgres
docker logs cda-redis
docker logs cda-nginx
```

## Troubleshooting

### API not starting
```bash
# Check PM2 logs
pm2 logs cda-api --lines 100

# Check if PostgreSQL is accessible
psql postgresql://postgres:secure_postgres_password_2024@localhost:5432/cda -c "SELECT 1;"
```

### Database connection issues
```bash
# Check PostgreSQL status
docker logs cda-postgres

# Restart PostgreSQL
docker restart cda-postgres
```

### Nginx issues
```bash
# Check Nginx logs
docker logs cda-nginx

# Check Nginx config
docker exec cda-nginx nginx -t

# Restart Nginx
docker restart cda-nginx
```

## URLs

- API: https://cda.ilinqsoft.com/api/health
- Dashboard: https://cda.ilinqsoft.com
- Terminal: https://cda.ilinqsoft.com/terminal

## Next Steps

After successful deployment, you can:

1. **Clean up old Docker files**: Run the cleanup plan in [CLEANUP_PLAN.md](CLEANUP_PLAN.md)
2. **Set up PM2 startup**: Ensure PM2 starts on server reboot
3. **Configure monitoring**: Set up alerts for PM2 and Docker services
4. **Backup database**: Set up automated PostgreSQL backups
