# Fix database - run migrations
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

    # Check if migrations folder exists
    Write-Host "=== Check migrations folder ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "ls -la /root/CDA/apps/api/src/database/ 2>&1 || echo 'No database folder'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check if there's a migration script or schema
    Write-Host "=== Check for schema files ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "find /root/CDA -name '*.sql' -o -name 'schema.ts' -o -name 'migrations*' 2>/dev/null | head -20" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check package.json for migration scripts
    Write-Host "=== Check API package.json scripts ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cat /root/CDA/apps/api/package.json | grep -A 20 'scripts'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check for drizzle or prisma config
    Write-Host "=== Check for ORM config ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "ls -la /root/CDA/apps/api/*.config.* /root/CDA/apps/api/drizzle* /root/CDA/apps/api/prisma* 2>/dev/null || echo 'No ORM config found'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check database schema in source
    Write-Host "=== Check database schema source ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "cat /root/CDA/apps/api/src/database/schema.ts 2>/dev/null | head -100 || echo 'No schema.ts found'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test CLI auth with proper body
    Write-Host "=== Test CLI auth with proper JSON body ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -X POST http://localhost:3000/api/cli-auth/claude-code/start -H 'Content-Type: application/json' -d '{}'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
