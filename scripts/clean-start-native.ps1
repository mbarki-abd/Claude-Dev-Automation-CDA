# Clean Start: Remove everything and deploy fresh native setup
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "`n=== Clean Start: Native Deployment ===" -ForegroundColor Cyan
Write-Host ""

$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if (-not $session) {
    Write-Host "Failed to connect to server" -ForegroundColor Red
    exit 1
}

# Step 1: Stop and remove ALL Docker containers
Write-Host "`n[1/8] Stopping and removing all Docker containers..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker stop `$(docker ps -aq) 2>/dev/null || true" -TimeOut 60
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker rm `$(docker ps -aq) 2>/dev/null || true" -TimeOut 60
Write-Host "All containers removed" -ForegroundColor Green

# Step 2: Stop PM2 processes
Write-Host "`n[2/8] Stopping PM2 processes..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 delete all 2>/dev/null || true" -TimeOut 30
Write-Host "PM2 processes stopped" -ForegroundColor Green

# Step 3: Remove old CDA directory
Write-Host "`n[3/8] Removing old CDA directory..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "rm -rf /root/CDA" -TimeOut 30
Write-Host "Old directory removed" -ForegroundColor Green

# Step 4: Clone fresh repository
Write-Host "`n[4/8] Cloning fresh repository..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cd /root && git clone https://github.com/your-org/CDA.git 2>&1 || echo 'Using existing code'" -TimeOut 120
Write-Host "Repository ready" -ForegroundColor Green

# Step 5: Upload native configuration files
Write-Host "`n[5/8] Uploading native configuration..." -ForegroundColor Yellow

# Create .env file
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
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "mkdir -p /root/CDA && echo '$envB64' | base64 -d > /root/CDA/.env" -TimeOut 30

# Upload docker-compose (only for PostgreSQL and Redis)
$dockerCompose = Get-Content -Path "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA\infrastructure\docker-compose.native.yml" -Raw
$dockerComposeB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dockerCompose))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "mkdir -p /root/CDA/infrastructure && echo '$dockerComposeB64' | base64 -d > /root/CDA/infrastructure/docker-compose.yml" -TimeOut 30

# Upload Nginx native config
$nginxConf = Get-Content -Path "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA\infrastructure\nginx.native.conf" -Raw
# Fix the host.docker.internal issue for Linux
$nginxConf = $nginxConf -replace 'host\.docker\.internal:3000', '172.17.0.1:3000'
$nginxConfB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($nginxConf))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "echo '$nginxConfB64' | base64 -d > /root/CDA/infrastructure/nginx.conf" -TimeOut 30

# Upload PM2 ecosystem config
$ecosystem = Get-Content -Path "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA\ecosystem.config.cjs" -Raw
$ecosystemB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($ecosystem))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "echo '$ecosystemB64' | base64 -d > /root/CDA/ecosystem.config.cjs" -TimeOut 30

Write-Host "Configuration files uploaded" -ForegroundColor Green

# Step 6: Start PostgreSQL and Redis only
Write-Host "`n[6/8] Starting PostgreSQL and Redis..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cd /root/CDA/infrastructure && docker compose up -d postgres redis 2>&1" -TimeOut 120
Write-Host $result.Output -ForegroundColor Gray

Start-Sleep -Seconds 10

# Step 7: Build application
Write-Host "`n[7/8] Building application..." -ForegroundColor Yellow
$buildScript = @'
#!/bin/bash
cd /root/CDA
export $(cat .env | grep -v '^#' | xargs)

echo "Installing dependencies..."
pnpm install 2>&1 | tail -10

echo "Building shared package..."
pnpm --filter @cda/shared build 2>&1 | tail -5

echo "Building API..."
pnpm --filter @cda/api build 2>&1 | tail -5

echo "Building Dashboard..."
pnpm --filter @cda/dashboard build 2>&1 | tail -5

echo "DONE"
'@
$buildScriptB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($buildScript))
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "echo '$buildScriptB64' | base64 -d > /tmp/build.sh && chmod +x /tmp/build.sh && /tmp/build.sh" -TimeOut 600
Write-Host $result.Output -ForegroundColor Gray

# Step 8: Start API with PM2
Write-Host "`n[8/8] Starting API with PM2..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cd /root/CDA && export `$(cat .env | grep -v '^#' | xargs) && pm2 start ecosystem.config.cjs && pm2 save" -TimeOut 60
Write-Host $result.Output -ForegroundColor Gray

Write-Host "`n=== Verification ===" -ForegroundColor Cyan

Start-Sleep -Seconds 5

# Check services
Write-Host "`nDocker Services:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker ps --format 'table {{.Names}}\t{{.Status}}'" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Write-Host "`nPM2 Status:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 status" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Write-Host "`nAPI Health:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s http://localhost:3000/api/health | jq '.'" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Remove-SSHSession -SessionId $session.SessionId

Write-Host "`n=== Clean Native Deployment Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Setup Nginx with Certbot for HTTPS" -ForegroundColor White
Write-Host "2. Deploy dashboard static files" -ForegroundColor White
Write-Host "3. Test the application" -ForegroundColor White
Write-Host ""
