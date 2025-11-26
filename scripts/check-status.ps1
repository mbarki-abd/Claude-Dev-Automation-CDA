# Check complete status of native deployment
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "`n=== Native Deployment Status ===" -ForegroundColor Cyan

$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

# Check Docker services
Write-Host "`n[1] Docker Services:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

# Check PM2 status
Write-Host "`n[2] PM2 Status:" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 status" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

# Check PM2 logs (last 40 lines)
Write-Host "`n[3] PM2 Logs (last 40 lines):" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 logs cda-api --lines 40 --nostream 2>&1" -TimeOut 15
Write-Host $result.Output -ForegroundColor Gray

# Test API health directly
Write-Host "`n[4] API Health (direct):" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -v http://localhost:3000/api/health 2>&1" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

# Test Dashboard
Write-Host "`n[5] Dashboard (via Nginx):" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -I https://cda.ilinqsoft.com 2>&1 | head -15" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

# Check Nginx logs
Write-Host "`n[6] Nginx Error Logs (last 10 lines):" -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker logs cda-nginx --tail 10 2>&1" -TimeOut 10
Write-Host $result.Output -ForegroundColor Gray

Remove-SSHSession -SessionId $session.SessionId

Write-Host "`n=== Complete ===" -ForegroundColor Cyan
