# Fix nginx configuration for cda.ilinqsoft.com
Import-Module Posh-SSH -ErrorAction Stop

$serverIP = '78.47.138.194'
$username = 'root'
$password = ConvertTo-SecureString 'EubnUUAVJKVF' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)

Write-Host "Connecting to server $serverIP..."
$session = New-SSHSession -ComputerName $serverIP -Credential $cred -AcceptKey -Force

if ($session) {
    Write-Host "Connected! Fixing nginx configuration..."
    Write-Host ""

    # Update nginx configuration - Dashboard on 5173, API on 3000
    Write-Host "=== Update nginx config ==="
    $nginxConfig = @'
server {
    server_name cda.ilinqsoft.com;

    # Dashboard (frontend)
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API backend
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support for Socket.IO
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/cda.ilinqsoft.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cda.ilinqsoft.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = cda.ilinqsoft.com) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name cda.ilinqsoft.com;
    return 404;
}
'@

    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command @"
cat > /etc/nginx/sites-available/cda.ilinqsoft.com << 'NGINXEOF'
$nginxConfig
NGINXEOF
echo 'Nginx config updated'
"@ -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test nginx configuration
    Write-Host "=== Test nginx config ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "nginx -t 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Reload nginx
    Write-Host "=== Reload nginx ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "systemctl reload nginx 2>&1" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Check container ports
    Write-Host "=== Check container ports ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "docker ps --format 'table {{.Names}}\t{{.Ports}}'" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    # Test the endpoints
    Write-Host "=== Test API endpoint ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s http://localhost:3000/api/health" -TimeOut 30
    Write-Host "Output: $($result.Output)"
    Write-Host ""

    Write-Host "=== Test Dashboard endpoint ==="
    $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/" -TimeOut 30
    Write-Host "Output: HTTP $($result.Output)"
    Write-Host ""

    Remove-SSHSession -SessionId $session.SessionId
    Write-Host "=== NGINX FIX COMPLETE ==="
    Write-Host ""
    Write-Host "Test the domain at: https://cda.ilinqsoft.com"
} else {
    Write-Host "Failed to connect to server"
    exit 1
}
