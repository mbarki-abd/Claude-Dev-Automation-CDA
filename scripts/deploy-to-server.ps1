# CDA Deployment Script using Posh-SSH
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "Connecting to server $serverIP..."
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if ($session) {
    Write-Host "Connected! Deploying CDA updates..."

    # Pull latest and rebuild
    $commands = @(
        'cd /root/CDA && git pull origin main 2>&1',
        'cd /root/CDA && docker compose -f infrastructure/docker-compose.yml down 2>&1',
        'cd /root/CDA && docker compose -f infrastructure/docker-compose.yml up -d --build 2>&1',
        'sleep 10',
        'docker ps --format "table {{.Names}}\t{{.Status}}"',
        'curl -s http://localhost:3000/api/health 2>&1'
    )

    foreach ($cmd in $commands) {
        Write-Host "Running: $cmd"
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 600
        Write-Host $result.Output
        Write-Host "---"
    }

    Remove-SSHSession -SessionId $session.SessionId
    Write-Host "Deployment complete!"
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
