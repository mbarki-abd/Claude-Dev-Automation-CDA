# Deploy to production and run Playwright tests
# Usage: .\deploy-and-test.ps1

param(
    [switch]$SkipDeploy,
    [switch]$SkipTest
)

$ErrorActionPreference = "Continue"
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)
$projectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

if (-not $SkipDeploy) {
    Write-Step "Connecting to server $serverIP"
    $session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

    if (-not $session) {
        Write-Error "Failed to connect to server"
        exit 1
    }
    Write-Success "Connected"

    # Pull latest code
    Write-Step "Pulling latest code from GitHub"
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @'
cd /root/CDA && git fetch origin && git reset --hard origin/main && git log -1 --oneline
'@ -TimeOut 120
    Write-Host $result.Output
    if ($result.ExitStatus -ne 0) {
        Write-Error "Git pull failed"
        Remove-SSHSession -SessionId $session.SessionId
        exit 1
    }
    Write-Success "Code updated"

    # Rebuild and restart containers
    Write-Step "Rebuilding and restarting containers"
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @'
cd /root/CDA
docker compose -f infrastructure/docker-compose.yml build --no-cache api dashboard 2>&1 | tail -30
docker compose -f infrastructure/docker-compose.yml up -d --force-recreate api dashboard 2>&1
echo "Waiting 20 seconds for containers to start..."
sleep 20
docker ps --format 'table {{.Names}}\t{{.Status}}'
'@ -TimeOut 600
    Write-Host $result.Output
    Write-Success "Containers rebuilt"

    # Run database migrations
    Write-Step "Running database migrations"
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @'
docker exec -i infrastructure-postgres-1 psql -U cda -d cda < /root/CDA/infrastructure/init.sql 2>&1
docker exec -i infrastructure-postgres-1 psql -U cda -d cda < /root/CDA/scripts/fix-schema.sql 2>&1
'@ -TimeOut 60
    Write-Host $result.Output
    Write-Success "Migrations complete"

    # Insert Hetzner settings if not present
    Write-Step "Ensuring Hetzner settings exist"
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @'
cat > /tmp/insert_hetzner.sql << 'SQLEOF'
INSERT INTO settings (key, value, updated_at) VALUES
('hetzner', '{"host": "78.47.138.194", "port": 22, "username": "root", "authMethod": "password", "password": "EubnUUAVJKVF"}', NOW())
ON CONFLICT (key) DO NOTHING;
SQLEOF
docker exec -i infrastructure-postgres-1 psql -U cda -d cda < /tmp/insert_hetzner.sql
'@ -TimeOut 30
    Write-Host $result.Output
    Write-Success "Settings configured"

    # Verify API health
    Write-Step "Verifying API health"
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s http://localhost:3000/api/health" -TimeOut 30
    Write-Host $result.Output
    if ($result.Output -match '"status":"healthy"') {
        Write-Success "API is healthy"
    } else {
        Write-Error "API health check failed"

        # Show API logs on failure
        Write-Host "API Logs:"
        $logs = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker logs infrastructure-api-1 --tail 50 2>&1" -TimeOut 30
        Write-Host $logs.Output
    }

    # Verify Dashboard
    Write-Step "Verifying Dashboard"
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/" -TimeOut 30
    if ($result.Output -eq "200") {
        Write-Success "Dashboard is responding"
    } else {
        Write-Error "Dashboard returned HTTP $($result.Output)"
    }

    Remove-SSHSession -SessionId $session.SessionId
    Write-Host ""
    Write-Host "Deployment complete!" -ForegroundColor Green
}

if (-not $SkipTest) {
    Write-Step "Running Playwright tests against https://cda.ilinqsoft.com"

    Set-Location $projectRoot

    # Run tests
    npx playwright test --config=playwright.production.config.ts 2>&1
    $testResult = $LASTEXITCODE

    if ($testResult -eq 0) {
        Write-Success "All tests passed!"
    } else {
        Write-Error "Some tests failed (exit code: $testResult)"
        Write-Host "Opening test report..."
        npx playwright show-report
    }

    exit $testResult
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
