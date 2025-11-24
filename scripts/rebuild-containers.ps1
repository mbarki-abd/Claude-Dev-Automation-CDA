# CDA Container Rebuild Script using Posh-SSH
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "Connecting to server $serverIP..."
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if ($session) {
    Write-Host "Connected! Rebuilding CDA containers..."

    # Force rebuild
    $commands = @(
        'cd /root/CDA && git fetch origin && git reset --hard origin/main 2>&1',
        'cd /root/CDA && docker compose -f infrastructure/docker-compose.yml down 2>&1',
        'cd /root/CDA && docker compose -f infrastructure/docker-compose.yml build --no-cache api 2>&1',
        'cd /root/CDA && docker compose -f infrastructure/docker-compose.yml up -d 2>&1',
        'sleep 15',
        'docker ps --format "table {{.Names}}\t{{.Status}}"',
        'curl -s http://localhost:3000/api/health 2>&1',
        'curl -s http://localhost:3000/api/cli-auth/status 2>&1'
    )

    foreach ($cmd in $commands) {
        Write-Host "Running: $cmd"
        Write-Host "---"
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 1200
        Write-Host $result.Output
        Write-Host ""
    }

    Remove-SSHSession -SessionId $session.SessionId
    Write-Host "Rebuild complete!"
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
