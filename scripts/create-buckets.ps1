$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$planId = "ctRnzrpOaEO3iPbe_cZpoZgAGBUM"

# Create buckets without orderHint - let Planner auto-generate it

Write-Host "Creating In Progress bucket..." -ForegroundColor Yellow
$inProgressBody = @{
    "name" = "In Progress"
    "planId" = $planId
} | ConvertTo-Json
$inProgressFile = "$env:TEMP\cda-inprogress.json"
$inProgressBody | Out-File -FilePath $inProgressFile -Encoding utf8 -NoNewline
$inProgressResult = & $azCmd rest --method POST --uri "https://graph.microsoft.com/v1.0/planner/buckets" --headers "Content-Type=application/json" --body "@$inProgressFile" 2>&1
Write-Host $inProgressResult

Write-Host "Creating Completed bucket..." -ForegroundColor Yellow
$completedBody = @{
    "name" = "Completed"
    "planId" = $planId
} | ConvertTo-Json
$completedFile = "$env:TEMP\cda-completed.json"
$completedBody | Out-File -FilePath $completedFile -Encoding utf8 -NoNewline
$completedResult = & $azCmd rest --method POST --uri "https://graph.microsoft.com/v1.0/planner/buckets" --headers "Content-Type=application/json" --body "@$completedFile" 2>&1
Write-Host $completedResult

Write-Host "Creating Failed bucket..." -ForegroundColor Yellow
$failedBody = @{
    "name" = "Failed"
    "planId" = $planId
} | ConvertTo-Json
$failedFile = "$env:TEMP\cda-failed.json"
$failedBody | Out-File -FilePath $failedFile -Encoding utf8 -NoNewline
$failedResult = & $azCmd rest --method POST --uri "https://graph.microsoft.com/v1.0/planner/buckets" --headers "Content-Type=application/json" --body "@$failedFile" 2>&1
Write-Host $failedResult

Write-Host "Done! All buckets created." -ForegroundColor Green

# Cleanup
Remove-Item $inProgressFile -ErrorAction SilentlyContinue
Remove-Item $completedFile -ErrorAction SilentlyContinue
Remove-Item $failedFile -ErrorAction SilentlyContinue
