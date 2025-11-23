<#
.SYNOPSIS
    Build and run the Claude Dev Automation unified Docker container

.DESCRIPTION
    This script builds the unified Docker container that includes all components:
    - PostgreSQL database
    - Redis cache
    - Node.js API server
    - Nginx serving the React dashboard

.EXAMPLE
    .\scripts\docker-build.ps1
    .\scripts\docker-build.ps1 -Run
    .\scripts\docker-build.ps1 -Run -Detach
#>

param(
    [switch]$Run,
    [switch]$Detach,
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Dev Automation - Docker Build" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is available
$dockerInstalled = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerInstalled) {
    Write-Host "Docker is not installed. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Check if Docker daemon is running
try {
    docker info | Out-Null
} catch {
    Write-Host "Docker daemon is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

Write-Host "Docker is ready!" -ForegroundColor Green
Write-Host ""

# Build the container
if (-not $NoBuild) {
    Write-Host "Building unified Docker container..." -ForegroundColor Yellow
    Write-Host "This may take several minutes on first build." -ForegroundColor Gray
    Write-Host ""

    docker build -t claude-dev-automation:unified -f docker/Dockerfile.unified .

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "Build successful!" -ForegroundColor Green
}

# Run the container
if ($Run) {
    Write-Host ""
    Write-Host "Starting Claude Dev Automation container..." -ForegroundColor Yellow

    # Stop existing container if running
    docker stop cda-unified 2>$null
    docker rm cda-unified 2>$null

    $runArgs = @(
        "run"
        "--name", "cda-unified"
        "-p", "8080:80"
        "-v", "cda-postgres-data:/data/postgres"
        "-v", "cda-redis-data:/data/redis"
        "-v", "cda-logs:/var/log/supervisor"
    )

    # Add environment variables from .env if exists
    if (Test-Path ".env") {
        Write-Host "Loading environment from .env file..." -ForegroundColor Gray
        $runArgs += "--env-file", ".env"
    }

    if ($Detach) {
        $runArgs += "-d"
    }

    $runArgs += "claude-dev-automation:unified"

    & docker @runArgs

    if ($Detach) {
        Write-Host ""
        Write-Host "Container started in background!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Access the application:" -ForegroundColor White
        Write-Host "  Dashboard: http://localhost:8080" -ForegroundColor Cyan
        Write-Host "  API:       http://localhost:8080/api" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Useful commands:" -ForegroundColor White
        Write-Host "  View logs:     docker logs -f cda-unified" -ForegroundColor Gray
        Write-Host "  Stop:          docker stop cda-unified" -ForegroundColor Gray
        Write-Host "  Restart:       docker restart cda-unified" -ForegroundColor Gray
        Write-Host "  Shell access:  docker exec -it cda-unified /bin/bash" -ForegroundColor Gray
    }
}

if (-not $Run) {
    Write-Host ""
    Write-Host "To run the container:" -ForegroundColor White
    Write-Host "  .\scripts\docker-build.ps1 -Run" -ForegroundColor Cyan
    Write-Host "  .\scripts\docker-build.ps1 -Run -Detach" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or using docker-compose:" -ForegroundColor White
    Write-Host "  docker-compose -f docker-compose.unified.yml up" -ForegroundColor Cyan
}
