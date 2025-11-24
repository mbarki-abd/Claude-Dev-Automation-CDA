# CDA Sync Results to Planner
# Syncs execution results, comments, and status back to Microsoft Planner

$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$planId = "ctRnzrpOaEO3iPbe_cZpoZgAGBUM"
$apiUrl = "http://localhost:3000"

# Bucket IDs
$todoBucketId = "Mu8B-7xwVEmTX1H9mTlxFJgAD8mg"
$inProgressBucketId = "x-spEdLYFU-AumBQJEWIc5gAD7tV"
$completedBucketId = "MOzLmDGXWUGJcUqHK9vVgJgAKCeb"
$failedBucketId = "omNy8o9qi0inV9M6HSDCkJgAKCeb"

Write-Host "=== CDA Sync Results to Planner ===" -ForegroundColor Cyan

# Get all tasks from CDA API
Write-Host "Fetching tasks from CDA API..." -ForegroundColor Yellow
$tasksResult = Invoke-RestMethod -Uri "$apiUrl/api/tasks" -Method GET

if (-not $tasksResult.success) {
    Write-Host "Failed to get tasks from CDA API" -ForegroundColor Red
    exit 1
}

$tasks = $tasksResult.data
Write-Host "Found $($tasks.Count) tasks in CDA" -ForegroundColor Green

foreach ($task in $tasks) {
    Write-Host ""
    Write-Host "Processing: $($task.title)" -ForegroundColor White
    Write-Host "  CDA Status: $($task.status)" -ForegroundColor Gray
    Write-Host "  Planner ID: $($task.plannerId)" -ForegroundColor Gray

    # Skip if no planner ID linked
    if (-not $task.plannerId) {
        Write-Host "  No Planner task linked, skipping..." -ForegroundColor Yellow
        continue
    }

    # Determine target bucket based on status
    $targetBucketId = switch ($task.status) {
        "pending" { $todoBucketId }
        "queued" { $todoBucketId }
        "executing" { $inProgressBucketId }
        "completed" { $completedBucketId }
        "failed" { $failedBucketId }
        "cancelled" { $failedBucketId }
        default { $todoBucketId }
    }

    # Get current task from Planner to get etag
    Write-Host "  Getting task from Planner..." -ForegroundColor Gray
    $plannerTaskResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.plannerId)" 2>&1 | Out-String
    $plannerTask = $plannerTaskResult | ConvertFrom-Json

    if (-not $plannerTask.id) {
        Write-Host "  Task not found in Planner" -ForegroundColor Red
        continue
    }

    $etag = $plannerTask.'@odata.etag'
    Write-Host "  Current bucket: $($plannerTask.bucketId)" -ForegroundColor Gray

    # Move task to correct bucket if needed
    if ($plannerTask.bucketId -ne $targetBucketId) {
        Write-Host "  Moving task to bucket: $targetBucketId" -ForegroundColor Cyan

        $updateBody = @{
            bucketId = $targetBucketId
        } | ConvertTo-Json

        $updateFile = "$env:TEMP\cda-update-task.json"
        $updateBody | Out-File -FilePath $updateFile -Encoding utf8 -NoNewline

        & $azCmd rest --method PATCH `
            --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.plannerId)" `
            --headers "Content-Type=application/json" "If-Match=$etag" `
            --body "@$updateFile" 2>&1 | Out-Null

        Remove-Item $updateFile -ErrorAction SilentlyContinue
        Write-Host "  Task moved successfully" -ForegroundColor Green
    }

    # Get execution results
    $executionsResult = Invoke-RestMethod -Uri "$apiUrl/api/executions?taskId=$($task.id)" -Method GET

    if ($executionsResult.success -and $executionsResult.data.Count -gt 0) {
        $latestExecution = $executionsResult.data[0]
        Write-Host "  Latest execution: $($latestExecution.status)" -ForegroundColor Gray

        # Get task details for etag
        $detailsResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.plannerId)/details" 2>&1 | Out-String
        $details = $detailsResult | ConvertFrom-Json
        $detailsEtag = $details.'@odata.etag'

        # Build description with execution results
        $executionSummary = @"
## CDA Execution Results

**Status:** $($latestExecution.status)
**Duration:** $($latestExecution.durationMs)ms
**Exit Code:** $($latestExecution.exitCode)
**Started:** $($latestExecution.startedAt)
**Completed:** $($latestExecution.completedAt)

### Output
$($latestExecution.output)

"@

        if ($latestExecution.error) {
            $executionSummary += @"

### Error
$($latestExecution.error)
"@
        }

        # Update task details with execution results
        Write-Host "  Updating task details with execution results..." -ForegroundColor Cyan

        $detailsBody = @{
            description = $executionSummary
        } | ConvertTo-Json

        $detailsFile = "$env:TEMP\cda-update-details.json"
        $detailsBody | Out-File -FilePath $detailsFile -Encoding utf8 -NoNewline

        & $azCmd rest --method PATCH `
            --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.plannerId)/details" `
            --headers "Content-Type=application/json" "If-Match=$detailsEtag" `
            --body "@$detailsFile" 2>&1 | Out-Null

        Remove-Item $detailsFile -ErrorAction SilentlyContinue
        Write-Host "  Details updated" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=== Sync Complete ===" -ForegroundColor Cyan
