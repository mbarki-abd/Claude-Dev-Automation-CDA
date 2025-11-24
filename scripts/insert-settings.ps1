# Insert Hetzner settings into database directly
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

    # Create SQL file and execute
    Write-Host "=== Insert Hetzner settings ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @'
cat > /tmp/insert_hetzner.sql << 'SQLEOF'
INSERT INTO settings (key, value, updated_at) VALUES
('hetzner', '{"host": "78.47.138.194", "port": 22, "username": "root", "authMethod": "password", "password": "EubnUUAVJKVF"}', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
SQLEOF
docker exec -i infrastructure-postgres-1 psql -U cda -d cda < /tmp/insert_hetzner.sql
'@ -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Verify
    Write-Host "=== Verify settings ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec infrastructure-postgres-1 psql -U cda -d cda -c 'SELECT key, value FROM settings;'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test CLI auth again
    Write-Host "=== Test CLI auth start ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -X POST http://localhost:3000/api/cli-auth/claude-code/start -H 'Content-Type: application/json' -d '{}'" -TimeOut 60
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
