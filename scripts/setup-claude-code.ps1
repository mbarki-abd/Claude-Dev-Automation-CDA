<#
.SYNOPSIS
    Configure Claude Code Terminal for Claude Dev Automation

.DESCRIPTION
    This script sets up Claude Code CLI for use with CDA.
    It handles authentication and configuration for the execution engine.

.NOTES
    Prerequisites:
    - Node.js 20+ installed
    - Claude Code CLI installed (npm install -g @anthropic-ai/claude-code)
#>

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Code Terminal Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "Node.js not found. Please install Node.js 20+ first." -ForegroundColor Red
    Write-Host "Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
Write-Host "Node.js Version: $nodeVersion" -ForegroundColor Green

# Check if Claude Code CLI is installed
Write-Host ""
Write-Host "Step 1: Checking Claude Code CLI" -ForegroundColor Green
Write-Host "---------------------------------"

$claudeInstalled = npm list -g @anthropic-ai/claude-code 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Claude Code CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @anthropic-ai/claude-code
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install Claude Code CLI" -ForegroundColor Red
        exit 1
    }
}
Write-Host "Claude Code CLI is installed" -ForegroundColor Green

# Check Claude Code version
$claudeVersion = claude --version 2>$null
Write-Host "Claude Code Version: $claudeVersion" -ForegroundColor White

# Authentication
Write-Host ""
Write-Host "Step 2: Claude Code Authentication" -ForegroundColor Green
Write-Host "-----------------------------------"
Write-Host ""
Write-Host "Claude Code supports two authentication methods:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Claude.ai Account (Recommended)" -ForegroundColor Cyan
Write-Host "     - Uses your existing Claude.ai subscription" -ForegroundColor Gray
Write-Host "     - No API key needed" -ForegroundColor Gray
Write-Host "     - Run: claude login" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. API Key" -ForegroundColor Cyan
Write-Host "     - Uses Anthropic API directly" -ForegroundColor Gray
Write-Host "     - Requires ANTHROPIC_API_KEY environment variable" -ForegroundColor Gray
Write-Host "     - Get key from: https://console.anthropic.com/" -ForegroundColor Gray
Write-Host ""

$authChoice = Read-Host "Choose authentication method (1 for Claude.ai, 2 for API Key)"

if ($authChoice -eq "1") {
    Write-Host ""
    Write-Host "Opening Claude.ai login..." -ForegroundColor Yellow
    Write-Host "A browser window will open for authentication." -ForegroundColor White
    Write-Host ""

    # Run claude login
    claude login

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Successfully logged in to Claude.ai!" -ForegroundColor Green

        # Update .env to use Claude Code Terminal mode
        $envFile = Join-Path $PSScriptRoot ".." ".env"
        $envContent = Get-Content $envFile -Raw -ErrorAction SilentlyContinue

        # Remove ANTHROPIC_API_KEY if exists and add CLAUDE_CODE_AUTH
        $envContent = $envContent -replace "ANTHROPIC_API_KEY=.*\r?\n", ""

        if ($envContent -notmatch "CLAUDE_CODE_AUTH=") {
            $envContent += "`nCLAUDE_CODE_AUTH=claude-ai`n"
        }

        $envContent | Out-File -FilePath $envFile -Encoding UTF8 -NoNewline
        Write-Host "Updated .env to use Claude.ai authentication" -ForegroundColor Green
    }
    else {
        Write-Host "Login failed. Please try again." -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host ""
    Write-Host "API Key Authentication" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Get your API key from: https://console.anthropic.com/settings/keys" -ForegroundColor Cyan
    Write-Host ""

    $apiKey = Read-Host "Enter your Anthropic API Key (starts with sk-ant-)"

    if ($apiKey -notmatch "^sk-ant-") {
        Write-Host "Warning: API key doesn't match expected format (sk-ant-...)" -ForegroundColor Yellow
    }

    # Save to .env
    $envFile = Join-Path $PSScriptRoot ".." ".env"
    $envContent = Get-Content $envFile -Raw -ErrorAction SilentlyContinue

    if ($envContent -match "ANTHROPIC_API_KEY=") {
        $envContent = $envContent -replace "ANTHROPIC_API_KEY=.*", "ANTHROPIC_API_KEY=$apiKey"
    }
    else {
        $envContent += "`nANTHROPIC_API_KEY=$apiKey`n"
    }

    if ($envContent -notmatch "CLAUDE_CODE_AUTH=") {
        $envContent += "CLAUDE_CODE_AUTH=api-key`n"
    }
    else {
        $envContent = $envContent -replace "CLAUDE_CODE_AUTH=.*", "CLAUDE_CODE_AUTH=api-key"
    }

    $envContent | Out-File -FilePath $envFile -Encoding UTF8 -NoNewline
    Write-Host "API Key saved to .env" -ForegroundColor Green
}

# Test Claude Code
Write-Host ""
Write-Host "Step 3: Testing Claude Code" -ForegroundColor Green
Write-Host "----------------------------"
Write-Host ""

Write-Host "Running test command..." -ForegroundColor Yellow
$testResult = claude --version 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Claude Code is working correctly!" -ForegroundColor Green
}
else {
    Write-Host "Warning: Claude Code test failed" -ForegroundColor Yellow
    Write-Host $testResult -ForegroundColor Gray
}

# MCP Configuration
Write-Host ""
Write-Host "Step 4: MCP Server Configuration" -ForegroundColor Green
Write-Host "---------------------------------"
Write-Host ""
Write-Host "Claude Code supports MCP (Model Context Protocol) servers for extended capabilities." -ForegroundColor White
Write-Host ""

# Create MCP config directory
$mcpConfigDir = Join-Path $env:APPDATA "claude-code"
if (-not (Test-Path $mcpConfigDir)) {
    New-Item -ItemType Directory -Path $mcpConfigDir -Force | Out-Null
}

$mcpConfigFile = Join-Path $mcpConfigDir "mcp.json"

$mcpConfig = @{
    mcpServers = @{
        filesystem = @{
            command = "npx"
            args = @("-y", "@anthropic-ai/mcp-server-filesystem")
        }
        github = @{
            command = "npx"
            args = @("-y", "@anthropic-ai/mcp-server-github")
            env = @{
                GITHUB_TOKEN = "`${GITHUB_TOKEN}"
            }
        }
    }
}

$mcpConfig | ConvertTo-Json -Depth 10 | Out-File -FilePath $mcpConfigFile -Encoding UTF8
Write-Host "MCP configuration saved to: $mcpConfigFile" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Code Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Claude Code Terminal is now configured for CDA." -ForegroundColor White
Write-Host ""
Write-Host "Available Commands:" -ForegroundColor Yellow
Write-Host "  claude             - Start interactive Claude Code session" -ForegroundColor Gray
Write-Host "  claude --help      - Show all available options" -ForegroundColor Gray
Write-Host "  claude login       - Re-authenticate with Claude.ai" -ForegroundColor Gray
Write-Host "  claude logout      - Log out from Claude.ai" -ForegroundColor Gray
Write-Host ""
Write-Host "Integration with CDA:" -ForegroundColor Yellow
Write-Host "  - CDA uses Claude Code Terminal as the execution engine" -ForegroundColor Gray
Write-Host "  - Tasks from Planner are executed using Claude Code" -ForegroundColor Gray
Write-Host "  - All output is streamed to the dashboard in real-time" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentation:" -ForegroundColor Yellow
Write-Host "  - Claude Code Docs: https://docs.anthropic.com/claude-code" -ForegroundColor Cyan
Write-Host "  - MCP Protocol: https://modelcontextprotocol.io" -ForegroundColor Cyan
Write-Host ""
