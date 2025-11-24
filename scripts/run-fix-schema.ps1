# Run the fix-schema.sql in the Docker PostgreSQL container
$dockerPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$sqlFile = "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA\scripts\fix-schema.sql"

# Read SQL file and escape single quotes
$sql = Get-Content $sqlFile -Raw

Write-Host "Running schema fix..." -ForegroundColor Yellow

# Copy file to container
& $dockerPath cp $sqlFile "infrastructure-postgres-1:/tmp/fix-schema.sql"

# Execute SQL
& $dockerPath exec infrastructure-postgres-1 psql -U cda -d cda -f /tmp/fix-schema.sql

Write-Host "Done!" -ForegroundColor Green
