$env:HTTP_PROXY = "http://localhost:8888"
$env:HTTPS_PROXY = "http://localhost:8888"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

Write-Host "Running 'claude' with proxy settings..." -ForegroundColor Cyan
Write-Host "HTTP_PROXY: $env:HTTP_PROXY"
Write-Host "HTTPS_PROXY: $env:HTTPS_PROXY"
Write-Host ""

# Run claude - it will show the interactive menu
claude
