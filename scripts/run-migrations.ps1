# Run database migrations
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "Connecting to server $serverIP..."
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if ($session) {
    Write-Host "Connected! Running database migrations..."
    Write-Host ""

    # Check init.sql content
    Write-Host "=== Check init.sql content ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cat /root/CDA/infrastructure/init.sql" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Run init.sql on the database
    Write-Host "=== Run init.sql ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec -i infrastructure-postgres-1 psql -U cda -d cda < /root/CDA/infrastructure/init.sql 2>&1" -TimeOut 60
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check fix-schema.sql content
    Write-Host "=== Check fix-schema.sql content ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cat /root/CDA/scripts/fix-schema.sql 2>/dev/null || echo 'No fix-schema.sql'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Run fix-schema.sql if it exists
    Write-Host "=== Run fix-schema.sql ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec -i infrastructure-postgres-1 psql -U cda -d cda < /root/CDA/scripts/fix-schema.sql 2>&1 || echo 'Skipped'" -TimeOut 60
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check tables now
    Write-Host "=== Check database tables ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec infrastructure-postgres-1 psql -U cda -d cda -c '\dt'" -TimeOut 30
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
