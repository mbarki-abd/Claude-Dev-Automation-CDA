# Check API logs on server
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

    # Check API logs
    Write-Host "=== API logs (last 50 lines) ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker logs infrastructure-api-1 --tail 50 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test the CLI auth start endpoint
    Write-Host "=== Test CLI auth start endpoint ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -X POST http://localhost:3000/api/cli-auth/claude-code/start -H 'Content-Type: application/json'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check container environment
    Write-Host "=== API container environment ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec infrastructure-api-1 env | grep -E 'NODE_ENV|DATABASE|REDIS'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
