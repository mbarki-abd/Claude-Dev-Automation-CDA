# GitHub-Based Deployment - Reliable file transfer via git clone
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)
$githubRepo = 'https://github.com/mbarki-abd/Claude-Dev-Automation-CDA.git'

Write-Host "`n=== GitHub-Based Deployment ===" -ForegroundColor Cyan
Write-Host "Repository: $githubRepo`n" -ForegroundColor Cyan

# Step 1: Connect to server
Write-Host "[1/6] Connecting to server..." -ForegroundColor Yellow
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if (-not $session) {
    Write-Host "Failed to connect to server" -ForegroundColor Red
    exit 1
}
Write-Host "Connected" -ForegroundColor Green

# Step 2: Clean server
Write-Host "`n[2/6] Cleaning server..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker stop `$(docker ps -aq) 2>/dev/null || true && docker rm `$(docker ps -aq) 2>/dev/null || true && pm2 delete all 2>/dev/null || true && rm -rf /root/CDA" -TimeOut 60
Write-Host "Server cleaned" -ForegroundColor Green

# Step 3: Clone from GitHub
Write-Host "`n[3/6] Cloning from GitHub..." -ForegroundColor Yellow

$cloneScript = @"
#!/bin/bash
set -e

cd /root
git clone $githubRepo CDA

echo "Repository cloned successfully"
ls -la /root/CDA | head -20
"@

$cloneB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($cloneScript))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "echo '$cloneB64' | base64 -d > /tmp/clone.sh && chmod +x /tmp/clone.sh && /tmp/clone.sh 2>&1" -TimeOut 120
Write-Host $result.Output -ForegroundColor Gray

# Step 4: Create environment files
Write-Host "`n[4/6] Creating environment files..." -ForegroundColor Yellow

$envContent = @'
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
'@

$envB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($envContent))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "echo '$envB64' | base64 -d > /root/CDA/infrastructure/.env" -TimeOut 30

# Fix nginx config for Linux
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "sed -i 's/host\.docker\.internal:3000/172.17.0.1:3000/g' /root/CDA/infrastructure/nginx.native.conf" -TimeOut 10

Write-Host "Environment files created" -ForegroundColor Green

# Step 5: Build and deploy
Write-Host "`n[5/6] Building and deploying application..." -ForegroundColor Yellow

$deployScript = @'
#!/bin/bash
set -e

cd /root/CDA

# Export environment
export $(cat infrastructure/.env | grep -v '^#' | xargs)

# Create workspace
mkdir -p /root/claude-workspace

# Start Docker services
echo "Starting Docker services..."
cd infrastructure
docker compose -f docker-compose.native.yml up -d postgres redis
sleep 10

# Install dependencies
echo "Installing dependencies..."
cd /root/CDA
pnpm install 2>&1 | tail -20

# Build packages
echo "Building @cda/shared..."
pnpm --filter @cda/shared build 2>&1 | tail -15

echo "Building @cda/api..."
pnpm --filter @cda/api build 2>&1 | tail -15

echo "Building @cda/dashboard..."
pnpm --filter @cda/dashboard build 2>&1 | tail -15

# Start API with PM2
echo "Starting API with PM2..."
pm2 delete cda-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Start Nginx
echo "Starting Nginx..."
cd infrastructure
docker compose -f docker-compose.native.yml up -d nginx

echo "DEPLOYMENT COMPLETE"
'@

$deployB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($deployScript))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "echo '$deployB64' | base64 -d > /tmp/deploy.sh && chmod +x /tmp/deploy.sh && /tmp/deploy.sh 2>&1" -TimeOut 600
Write-Host $result.Output -ForegroundColor Gray

# Step 6: Verification
Write-Host "`n[6/6] Verifying deployment..." -ForegroundColor Yellow

Start-Sleep -Seconds 5

Write-Host "`nDocker Services:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Write-Host "`nPM2 Status:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 status" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Write-Host "`nAPI Health:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s http://localhost:3000/api/health 2>&1" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Write-Host "`nDashboard:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -o /dev/null -w 'HTTP %{http_code}' https://cda.ilinqsoft.com 2>&1" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Remove-SSHSession -SessionId $session.SessionId

Write-Host "`n=== Deployment Complete ===" -ForegroundColor Cyan
Write-Host "API: https://cda.ilinqsoft.com/api/health" -ForegroundColor White
Write-Host "Dashboard: https://cda.ilinqsoft.com" -ForegroundColor White
Write-Host "Terminal: https://cda.ilinqsoft.com/terminal" -ForegroundColor White
Write-Host ""
