$dockerPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

Write-Host "Waiting for Docker daemon to be ready..."

for ($i = 1; $i -le 60; $i++) {
    try {
        $result = & $dockerPath info 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Docker is ready!"
            exit 0
        }
    } catch {
        # Ignore errors
    }
    Write-Host "Waiting for Docker daemon... ($i/60)"
    Start-Sleep -Seconds 5
}

Write-Host "Docker daemon not ready after 5 minutes"
exit 1
