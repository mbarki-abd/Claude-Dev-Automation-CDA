# Test SSH from Docker container to host
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

    # Check if API container can reach host via SSH
    Write-Host "=== Check docker network ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker network inspect infrastructure_default 2>/dev/null | grep Gateway || echo 'No gateway'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Get the host IP from container perspective
    Write-Host "=== Get host IP from container ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec infrastructure-api-1 sh -c 'ip route | grep default | awk \"{print \\\$3}\"'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test if container can connect to host SSH
    Write-Host "=== Test SSH from container to host ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker exec infrastructure-api-1 sh -c 'which ssh || echo ssh not installed'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check API logs for SSH connection
    Write-Host "=== API logs (last 30 lines) ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker logs infrastructure-api-1 --tail 30 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
