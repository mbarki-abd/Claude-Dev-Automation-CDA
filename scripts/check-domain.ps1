# Check domain configuration on server
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "Connecting to server $serverIP..."
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if ($session) {
    Write-Host "Connected!"
    Write-Host ""

    # Check nginx configuration
    Write-Host "=== Check nginx sites-available ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "ls -la /etc/nginx/sites-available/ 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check if there's a cda config
    Write-Host "=== Check cda nginx config ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cat /etc/nginx/sites-available/cda 2>/dev/null || cat /etc/nginx/sites-available/cda.ilinqsoft.com 2>/dev/null || echo 'No CDA nginx config found'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check sites-enabled
    Write-Host "=== Check nginx sites-enabled ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "ls -la /etc/nginx/sites-enabled/ 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check if nginx is running
    Write-Host "=== Check nginx status ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "systemctl status nginx 2>&1 | head -20" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check what's listening on port 80 and 443
    Write-Host "=== Check ports 80/443 ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "netstat -tlnp | grep -E ':80|:443' 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test local curl to API
    Write-Host "=== Test local API ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s http://localhost:3000/api/health" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
