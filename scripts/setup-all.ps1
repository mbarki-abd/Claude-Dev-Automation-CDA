# Complete setup script for Claude Dev Automation
$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  CDA Complete Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"

# STEP 1: Azure CLI
Write-Host "STEP 1: Azure CLI" -ForegroundColor Yellow

$azPath = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
if (Test-Path $azPath) {
    Write-Host "Azure CLI found at: $azPath" -ForegroundColor Green
} else {
    Write-Host "Installing Azure CLI..." -ForegroundColor Gray
    winget install Microsoft.AzureCLI --accept-package-agreements --accept-source-agreements
    Write-Host "Azure CLI installed!" -ForegroundColor Green
}

# STEP 2: Azure Login
Write-Host ""
Write-Host "STEP 2: Azure Login" -ForegroundColor Yellow

$az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
& $az login --allow-no-subscriptions
$account = & $az account show | ConvertFrom-Json
$TenantId = $account.tenantId
Write-Host "Logged in! Tenant: $TenantId" -ForegroundColor Green

# STEP 3: Create App
Write-Host ""
Write-Host "STEP 3: Azure AD App" -ForegroundColor Yellow

$AppName = "Claude-Dev-Automation"
$existingApp = & $az ad app list --display-name $AppName | ConvertFrom-Json

if ($existingApp.Count -gt 0) {
    Write-Host "Using existing app" -ForegroundColor Yellow
    $ClientId = $existingApp[0].appId
} else {
    $app = & $az ad app create --display-name $AppName --sign-in-audience AzureADMyOrg --web-redirect-uris "http://localhost:3000/auth/callback" "http://localhost:5173/auth/callback" | ConvertFrom-Json
    $ClientId = $app.appId
    Write-Host "App created! Client ID: $ClientId" -ForegroundColor Green
}

# Create secret
$secret = & $az ad app credential reset --id $ClientId --display-name "CDA-Secret" --years 2 | ConvertFrom-Json
$ClientSecret = $secret.password
Write-Host "Secret created" -ForegroundColor Green

# STEP 4: Claude Code
Write-Host ""
Write-Host "STEP 4: Claude Code" -ForegroundColor Yellow

$ClaudeAuthMethod = "claude-ai"
claude --version
if ($LASTEXITCODE -eq 0) {
    Write-Host "Claude Code ready" -ForegroundColor Green
}

# STEP 5: Update .env
Write-Host ""
Write-Host "STEP 5: Updating .env" -ForegroundColor Yellow

$envContent = Get-Content $envFile -Raw

$envContent = $envContent -replace "AZURE_TENANT_ID=.*", "AZURE_TENANT_ID=$TenantId"
$envContent = $envContent -replace "AZURE_CLIENT_ID=.*", "AZURE_CLIENT_ID=$ClientId"
$envContent = $envContent -replace "AZURE_CLIENT_SECRET=.*", "AZURE_CLIENT_SECRET=$ClientSecret"

if ($envContent -notmatch "CLAUDE_CODE_AUTH=") {
    $envContent += "`nCLAUDE_CODE_AUTH=claude-ai"
}

$envContent | Out-File -FilePath $envFile -Encoding UTF8
Write-Host "Configuration saved" -ForegroundColor Green

# STEP 6: Consent
Write-Host ""
Write-Host "STEP 6: Admin Consent" -ForegroundColor Yellow
$consentUrl = "https://login.microsoftonline.com/$TenantId/adminconsent?client_id=$ClientId"
Write-Host "Opening consent page..." -ForegroundColor Gray
Start-Process $consentUrl

Write-Host ""
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "Tenant: $TenantId" -ForegroundColor Gray
Write-Host "Client: $ClientId" -ForegroundColor Gray
