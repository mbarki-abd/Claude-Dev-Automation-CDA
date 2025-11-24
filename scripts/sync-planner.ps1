# CDA Planner Sync Script
# Uses Azure CLI (user-delegated) to sync tasks from Planner to CDA API

$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$planId = "ctRnzrpOaEO3iPbe_cZpoZgAGBUM"
$apiUrl = "http://localhost:3000"
$todoBucketId = "Mu8B-7xwVEmTX1H9mTlxFJgAD8mg"

Write-Host "=== CDA Planner Sync ===" -ForegroundColor Cyan
Write-Host "Plan ID: $planId" -ForegroundColor Gray

# Get tasks from Planner
Write-Host "Fetching tasks from Planner..." -ForegroundColor Yellow
$tasksResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/plans/$planId/tasks" 2>&1
$tasksJson = $tasksResult | Out-String | ConvertFrom-Json

if ($tasksJson.value) {
    $tasks = $tasksJson.value
    Write-Host "Found $($tasks.Count) tasks" -ForegroundColor Green

    foreach ($task in $tasks) {
        Write-Host ""
        Write-Host "Processing task: $($task.title)" -ForegroundColor White
        Write-Host "  ID: $($task.id)" -ForegroundColor Gray
        Write-Host "  Bucket: $($task.bucketId)" -ForegroundColor Gray
        Write-Host "  Progress: $($task.percentComplete)%" -ForegroundColor Gray

        # Determine status based on bucket
        $status = "pending"
        if ($task.bucketId -eq $todoBucketId) {
            $status = "pending"
        } elseif ($task.bucketId -eq "x-spEdLYFU-AumBQJEWIc5gAD7tV") {
            $status = "in_progress"
        } elseif ($task.bucketId -eq "MOzLmDGXWUGJcUqHK9vVgJgAKCeb") {
            $status = "completed"
        } elseif ($task.bucketId -eq "omNy8o9qi0inV9M6HSDCkJgAKCeb") {
            $status = "failed"
        }

        # Get task details for description
        $detailsResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.id)/details" 2>&1
        $detailsJson = $detailsResult | Out-String | ConvertFrom-Json
        $description = if ($detailsJson.description) { $detailsJson.description } else { "" }

        # Create/update task in CDA
        $taskBody = @{
            title = $task.title
            description = $description
            status = $status
            planner_task_id = $task.id
            bucket_id = $task.bucketId
            priority = switch ($task.priority) {
                1 { 1 }
                3 { 3 }
                5 { 5 }
                9 { 9 }
                default { 5 }
            }
            metadata = @{
                percentComplete = $task.percentComplete
                createdDateTime = $task.createdDateTime
            }
        } | ConvertTo-Json -Depth 3

        # First check if task exists
        try {
            $existingTask = Invoke-RestMethod -Uri "$apiUrl/api/tasks?planner_task_id=$($task.id)" -Method GET -ContentType "application/json"

            if ($existingTask.success -and $existingTask.data -and $existingTask.data.Count -gt 0) {
                # Update existing task
                $taskId = $existingTask.data[0].id
                Write-Host "  Updating existing task: $taskId" -ForegroundColor Cyan
                $updateResult = Invoke-RestMethod -Uri "$apiUrl/api/tasks/$taskId" -Method PUT -Body $taskBody -ContentType "application/json"
            } else {
                # Create new task
                Write-Host "  Creating new task in CDA" -ForegroundColor Green
                $createResult = Invoke-RestMethod -Uri "$apiUrl/api/tasks" -Method POST -Body $taskBody -ContentType "application/json"
            }
        } catch {
            # If GET fails with 404 or error, create new task
            Write-Host "  Creating new task in CDA" -ForegroundColor Green
            try {
                $createResult = Invoke-RestMethod -Uri "$apiUrl/api/tasks" -Method POST -Body $taskBody -ContentType "application/json"
                Write-Host "  Task created: $($createResult.data.id)" -ForegroundColor Green
            } catch {
                Write-Host "  Error creating task: $_" -ForegroundColor Red
            }
        }
    }
} else {
    Write-Host "No tasks found or error: $tasksResult" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Sync Complete ===" -ForegroundColor Cyan
