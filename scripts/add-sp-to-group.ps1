$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$groupId = "dc08bb06-2659-4d76-81cf-4b13def4a060"
$appId = "d85336b0-55e8-4a6b-8549-051f738c1495"

# Get service principal for CDA-Automation app using appId
Write-Host "Finding service principal for app ID: $appId..." -ForegroundColor Yellow
$spJson = & $azCmd ad sp show --id $appId -o json 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Service principal not found! Error: $spJson" -ForegroundColor Red
    Write-Host "Continuing without SP membership..." -ForegroundColor Yellow
} else {
    $sp = $spJson | ConvertFrom-Json
    $spId = $sp.id
    Write-Host "Service Principal ID: $spId" -ForegroundColor Green
}

# Create body for adding member (only if we found the SP)
$spBody = @{
    "@odata.id" = "https://graph.microsoft.com/v1.0/servicePrincipals/$spId"
} | ConvertTo-Json

$spFile = "$env:TEMP\cda-sp.json"
$spBody | Out-File -FilePath $spFile -Encoding utf8 -NoNewline

Write-Host "Adding service principal to group as member..." -ForegroundColor Yellow
& $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/groups/$groupId/members/`$ref" `
    --headers "Content-Type=application/json" `
    --body "@$spFile" 2>&1

Write-Host "Adding service principal to group as owner..." -ForegroundColor Yellow
& $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/groups/$groupId/owners/`$ref" `
    --headers "Content-Type=application/json" `
    --body "@$spFile" 2>&1

# Create buckets using Azure CLI (as user)
$planId = "ctRnzrpOaEO3iPbe_cZpoZgAGBUM"

Write-Host "Creating To Do bucket..." -ForegroundColor Yellow
$todoBody = @{
    "name" = "To Do"
    "planId" = $planId
    "orderHint" = " !"
} | ConvertTo-Json
$todoFile = "$env:TEMP\cda-todo.json"
$todoBody | Out-File -FilePath $todoFile -Encoding utf8 -NoNewline
$todoBucket = & $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/planner/buckets" `
    --headers "Content-Type=application/json" `
    --body "@$todoFile" 2>&1
Write-Host $todoBucket

Write-Host "Creating In Progress bucket..." -ForegroundColor Yellow
$inProgressBody = @{
    "name" = "In Progress"
    "planId" = $planId
    "orderHint" = " !!"
} | ConvertTo-Json
$inProgressFile = "$env:TEMP\cda-inprogress.json"
$inProgressBody | Out-File -FilePath $inProgressFile -Encoding utf8 -NoNewline
$inProgressBucket = & $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/planner/buckets" `
    --headers "Content-Type=application/json" `
    --body "@$inProgressFile" 2>&1
Write-Host $inProgressBucket

Write-Host "Creating Completed bucket..." -ForegroundColor Yellow
$completedBody = @{
    "name" = "Completed"
    "planId" = $planId
    "orderHint" = " !!!"
} | ConvertTo-Json
$completedFile = "$env:TEMP\cda-completed.json"
$completedBody | Out-File -FilePath $completedFile -Encoding utf8 -NoNewline
$completedBucket = & $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/planner/buckets" `
    --headers "Content-Type=application/json" `
    --body "@$completedFile" 2>&1
Write-Host $completedBucket

Write-Host "Creating Failed bucket..." -ForegroundColor Yellow
$failedBody = @{
    "name" = "Failed"
    "planId" = $planId
    "orderHint" = " !!!!"
} | ConvertTo-Json
$failedFile = "$env:TEMP\cda-failed.json"
$failedBody | Out-File -FilePath $failedFile -Encoding utf8 -NoNewline
$failedBucket = & $azCmd rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/planner/buckets" `
    --headers "Content-Type=application/json" `
    --body "@$failedFile" 2>&1
Write-Host $failedBucket

Write-Host "Done! All buckets created." -ForegroundColor Green

# Cleanup
Remove-Item $spFile -ErrorAction SilentlyContinue
Remove-Item $todoFile -ErrorAction SilentlyContinue
Remove-Item $inProgressFile -ErrorAction SilentlyContinue
Remove-Item $completedFile -ErrorAction SilentlyContinue
Remove-Item $failedFile -ErrorAction SilentlyContinue
