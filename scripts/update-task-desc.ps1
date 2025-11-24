$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$taskId = "nlsn-Gm7aEChWTN5N3-zN5gANHjn"

Write-Host "Getting task details..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

$detailsResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/tasks/$taskId/details" 2>&1
Write-Host $detailsResult

$detailsJson = $detailsResult | Out-String | ConvertFrom-Json

if ($detailsJson.'@odata.etag') {
    $etag = $detailsJson.'@odata.etag'
    Write-Host "ETag: $etag" -ForegroundColor Cyan

    $descBody = @{
        "description" = "Create a file named 'hello.txt' with the content 'Hello from CDA!'"
    } | ConvertTo-Json

    $descFile = "$env:TEMP\cda-task-desc.json"
    $descBody | Out-File -FilePath $descFile -Encoding utf8 -NoNewline

    Write-Host "Updating task description..." -ForegroundColor Yellow
    $descResult = & $azCmd rest --method PATCH --uri "https://graph.microsoft.com/v1.0/planner/tasks/$taskId/details" --headers "Content-Type=application/json" "If-Match=$etag" --body "@$descFile" 2>&1
    Write-Host $descResult

    Remove-Item $descFile -ErrorAction SilentlyContinue
}

Write-Host "Done!" -ForegroundColor Green
