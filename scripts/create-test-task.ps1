$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$planId = "ctRnzrpOaEO3iPbe_cZpoZgAGBUM"
$todoBucketId = "Mu8B-7xwVEmTX1H9mTlxFJgAD8mg"

Write-Host "Creating test task in Planner..." -ForegroundColor Yellow

$taskBody = @{
    "planId" = $planId
    "bucketId" = $todoBucketId
    "title" = "CDA Test Task: Create Hello World file"
} | ConvertTo-Json

$taskFile = "$env:TEMP\cda-test-task.json"
$taskBody | Out-File -FilePath $taskFile -Encoding utf8 -NoNewline

$taskResult = & $azCmd rest --method POST --uri "https://graph.microsoft.com/v1.0/planner/tasks" --headers "Content-Type=application/json" --body "@$taskFile" 2>&1
Write-Host $taskResult

# Extract task ID
if ($taskResult -match '"id"\s*:\s*"([^"]+)"') {
    $taskId = $Matches[1]
    Write-Host "Task ID: $taskId" -ForegroundColor Green

    # Now add description to the task details
    Write-Host "Adding task description..." -ForegroundColor Yellow

    # First get the task details to get the etag
    $detailsResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/tasks/$taskId/details" 2>&1
    Write-Host $detailsResult

    if ($detailsResult -match '"@odata.etag"\s*:\s*"([^"]+)"') {
        $etag = $Matches[1]
        Write-Host "ETag: $etag" -ForegroundColor Cyan

        $descBody = @{
            "description" = "Create a file named 'hello.txt' with the content 'Hello from CDA!'"
        } | ConvertTo-Json

        $descFile = "$env:TEMP\cda-task-desc.json"
        $descBody | Out-File -FilePath $descFile -Encoding utf8 -NoNewline

        $descResult = & $azCmd rest --method PATCH --uri "https://graph.microsoft.com/v1.0/planner/tasks/$taskId/details" --headers "Content-Type=application/json" "If-Match=$etag" --body "@$descFile" 2>&1
        Write-Host $descResult
    }
}

Write-Host "Done!" -ForegroundColor Green

# Cleanup
Remove-Item $taskFile -ErrorAction SilentlyContinue
Remove-Item $descFile -ErrorAction SilentlyContinue
