$groupId = "dc08bb06-2659-4d76-81cf-4b13def4a060"
$userId = "58dd8b91-fb49-4743-99e2-1ac02ffff44f"
$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

# Create temp files with JSON body
$memberBody = @{
    "@odata.id" = "https://graph.microsoft.com/v1.0/users/$userId"
} | ConvertTo-Json

$planBody = @{
    "owner" = $groupId
    "title" = "CDA Tasks"
} | ConvertTo-Json

# Save to temp files
$memberFile = "$env:TEMP\cda-member.json"
$planFile = "$env:TEMP\cda-plan.json"
$memberBody | Out-File -FilePath $memberFile -Encoding utf8 -NoNewline
$planBody | Out-File -FilePath $planFile -Encoding utf8 -NoNewline

Write-Host "Adding user as group member..." -ForegroundColor Yellow
& $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/groups/$groupId/members/`$ref" `
    --headers "Content-Type=application/json" `
    --body "@$memberFile" 2>&1

Write-Host "Adding user as group owner..." -ForegroundColor Yellow
& $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/groups/$groupId/owners/`$ref" `
    --headers "Content-Type=application/json" `
    --body "@$memberFile" 2>&1

Write-Host "Waiting for group provisioning..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host "Creating Planner plan..." -ForegroundColor Yellow
$result = & $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/planner/plans" `
    --headers "Content-Type=application/json" `
    --body "@$planFile" 2>&1

Write-Host "Plan Result:" -ForegroundColor Cyan
$result

# Parse and display Plan ID
if ($result -match '"id"\s*:\s*"([^"]+)"') {
    Write-Host "Plan ID: $($Matches[1])" -ForegroundColor Green
}

Write-Host "Done!" -ForegroundColor Green

# Cleanup temp files
Remove-Item $memberFile -ErrorAction SilentlyContinue
Remove-Item $planFile -ErrorAction SilentlyContinue
