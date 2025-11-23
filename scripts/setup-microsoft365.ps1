<#
.SYNOPSIS
    Configure Microsoft 365 / Azure AD App Registration for Claude Dev Automation

.DESCRIPTION
    This script helps you set up Azure AD App Registration to access Microsoft Planner.
    It guides you through the process and saves the configuration to .env file.

.NOTES
    Prerequisites:
    - Azure CLI installed (winget install Microsoft.AzureCLI)
    - Microsoft 365 account with admin access
    - PowerShell 7+ recommended
#>

param(
    [string]$TenantId,
    [string]$AppName = "Claude-Dev-Automation"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Microsoft 365 Setup for Claude Dev Automation" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if Azure CLI is installed
$azInstalled = Get-Command az -ErrorAction SilentlyContinue
if (-not $azInstalled) {
    Write-Host "Azure CLI not found. Installing..." -ForegroundColor Yellow
    winget install Microsoft.AzureCLI --accept-package-agreements --accept-source-agreements
    Write-Host "Please restart PowerShell after Azure CLI installation and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Step 1: Azure Login" -ForegroundColor Green
Write-Host "-------------------"
Write-Host "You will be redirected to browser for authentication..."
az login --allow-no-subscriptions

# Get tenant info
Write-Host ""
Write-Host "Step 2: Getting Tenant Information" -ForegroundColor Green
Write-Host "-----------------------------------"

$account = az account show | ConvertFrom-Json
$TenantId = $account.tenantId
Write-Host "Tenant ID: $TenantId" -ForegroundColor White

# Create App Registration
Write-Host ""
Write-Host "Step 3: Creating Azure AD App Registration" -ForegroundColor Green
Write-Host "-------------------------------------------"

$appManifest = @{
    displayName = $AppName
    signInAudience = "AzureADMyOrg"
    web = @{
        redirectUris = @(
            "http://localhost:3000/auth/callback",
            "http://localhost:5173/auth/callback"
        )
    }
    requiredResourceAccess = @(
        @{
            resourceAppId = "00000003-0000-0000-c000-000000000000"  # Microsoft Graph
            resourceAccess = @(
                @{ id = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"; type = "Scope" },  # User.Read
                @{ id = "7b2449af-6ccd-4f4d-9f78-e550c193f0d2"; type = "Scope" },  # Tasks.ReadWrite
                @{ id = "2219042f-cab5-40cc-b0d2-16b1540b4c5f"; type = "Scope" },  # Tasks.Read
                @{ id = "47758f0d-6564-4e93-a5ea-3f3b1c0d4e5a"; type = "Scope" }   # Group.Read.All (for Planner plans)
            )
        }
    )
}

$manifestJson = $appManifest | ConvertTo-Json -Depth 10
$manifestFile = [System.IO.Path]::GetTempFileName() + ".json"
$manifestJson | Out-File -FilePath $manifestFile -Encoding UTF8

try {
    $app = az ad app create --display-name $AppName `
        --sign-in-audience AzureADMyOrg `
        --web-redirect-uris "http://localhost:3000/auth/callback" "http://localhost:5173/auth/callback" `
        --required-resource-accesses $manifestFile | ConvertFrom-Json

    $ClientId = $app.appId
    Write-Host "App Registration Created!" -ForegroundColor Green
    Write-Host "Client ID: $ClientId" -ForegroundColor White
}
catch {
    Write-Host "Error creating app registration: $_" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item $manifestFile -ErrorAction SilentlyContinue
}

# Create Client Secret
Write-Host ""
Write-Host "Step 4: Creating Client Secret" -ForegroundColor Green
Write-Host "-------------------------------"

$secret = az ad app credential reset --id $ClientId --display-name "CDA-Secret" --years 2 | ConvertFrom-Json
$ClientSecret = $secret.password
Write-Host "Client Secret created (valid for 2 years)" -ForegroundColor Green

# Get Planner Plan ID
Write-Host ""
Write-Host "Step 5: Find Your Planner Plan ID" -ForegroundColor Green
Write-Host "----------------------------------"
Write-Host ""
Write-Host "To find your Planner Plan ID:" -ForegroundColor Yellow
Write-Host "1. Open Microsoft Planner in browser: https://tasks.office.com" -ForegroundColor White
Write-Host "2. Open the Plan you want to use" -ForegroundColor White
Write-Host "3. Copy the Plan ID from the URL:" -ForegroundColor White
Write-Host "   https://tasks.office.com/...planId=<PLAN_ID>&..." -ForegroundColor Cyan
Write-Host ""

$PlannerPlanId = Read-Host "Enter your Planner Plan ID (or press Enter to skip for now)"

# Save to .env file
Write-Host ""
Write-Host "Step 6: Saving Configuration" -ForegroundColor Green
Write-Host "-----------------------------"

$envFile = Join-Path $PSScriptRoot ".." ".env"
$envContent = Get-Content $envFile -ErrorAction SilentlyContinue

# Update or create .env entries
$envUpdates = @{
    "AZURE_TENANT_ID" = $TenantId
    "AZURE_CLIENT_ID" = $ClientId
    "AZURE_CLIENT_SECRET" = $ClientSecret
}

if ($PlannerPlanId) {
    $envUpdates["PLANNER_PLAN_ID"] = $PlannerPlanId
}

foreach ($key in $envUpdates.Keys) {
    $value = $envUpdates[$key]
    $pattern = "^$key=.*$"
    $replacement = "$key=$value"

    if ($envContent -match $pattern) {
        $envContent = $envContent -replace $pattern, $replacement
    }
    else {
        $envContent += "`n$replacement"
    }
}

$envContent | Out-File -FilePath $envFile -Encoding UTF8
Write-Host "Configuration saved to .env file" -ForegroundColor Green

# Admin Consent
Write-Host ""
Write-Host "Step 7: Grant Admin Consent" -ForegroundColor Green
Write-Host "---------------------------"
Write-Host ""
Write-Host "IMPORTANT: You need to grant admin consent for the API permissions." -ForegroundColor Yellow
Write-Host ""
$consentUrl = "https://login.microsoftonline.com/$TenantId/adminconsent?client_id=$ClientId"
Write-Host "Open this URL in your browser to grant consent:" -ForegroundColor White
Write-Host $consentUrl -ForegroundColor Cyan
Write-Host ""

$openBrowser = Read-Host "Open in browser now? (y/n)"
if ($openBrowser -eq "y") {
    Start-Process $consentUrl
}

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration Summary:" -ForegroundColor White
Write-Host "  Tenant ID:     $TenantId" -ForegroundColor Gray
Write-Host "  Client ID:     $ClientId" -ForegroundColor Gray
Write-Host "  Client Secret: [Saved to .env]" -ForegroundColor Gray
if ($PlannerPlanId) {
    Write-Host "  Planner Plan:  $PlannerPlanId" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Grant admin consent using the URL above" -ForegroundColor White
Write-Host "2. Start the API: pnpm dev:api" -ForegroundColor White
Write-Host "3. Open dashboard: http://localhost:5173" -ForegroundColor White
Write-Host "4. Go to Settings > Connect Planner" -ForegroundColor White
Write-Host ""
