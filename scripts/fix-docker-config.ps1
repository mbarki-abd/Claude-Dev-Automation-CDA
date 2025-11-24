$dockerConfigDir = "$env:USERPROFILE\.docker"
$configFile = "$dockerConfigDir\config.json"

if (-not (Test-Path $dockerConfigDir)) {
    New-Item -ItemType Directory -Force -Path $dockerConfigDir | Out-Null
}

# Create empty config to avoid credential helper issues
Set-Content -Path $configFile -Value '{}'

Write-Host "Docker config created at $configFile"
