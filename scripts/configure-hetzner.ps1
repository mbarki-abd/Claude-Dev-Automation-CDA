# Configure Hetzner SSH settings in database
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "Connecting to server $serverIP..."
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if ($session) {
    Write-Host "Connected! Configuring Hetzner settings..."
    Write-Host ""

    # Insert Hetzner settings into database
    Write-Host "=== Configure Hetzner SSH settings ==="
    $hetznerConfig = @'
{
    "host": "78.47.138.194",
    "port": 22,
    "username": "root",
    "authMethod": "password",
    "password": "EubnUUAVJKVF"
}
'@

    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @"
docker exec infrastructure-postgres-1 psql -U cda -d cda -c "INSERT INTO settings (key, value, updated_at) VALUES ('hetzner', '$hetznerConfig', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();"
"@ -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Verify settings
    Write-Host "=== Verify settings ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec infrastructure-postgres-1 psql -U cda -d cda -c \"SELECT key, value FROM settings WHERE key = 'hetzner';\"" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Create claude workspace directory
    Write-Host "=== Create claude workspace ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "mkdir -p /root/claude-workspace && ls -la /root/claude-workspace" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check if claude is installed
    Write-Host "=== Check Claude Code ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "which claude 2>/dev/null || npm list -g | grep claude || echo 'Claude not installed'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test CLI auth again
    Write-Host "=== Test CLI auth start ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -X POST http://localhost:3000/api/cli-auth/claude-code/start -H 'Content-Type: application/json' -d '{}'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
