# Create WordPress MCP Server Task in Planner
$azCmd = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$planId = "ctRnzrpOaEO3iPbe_cZpoZgAGBUM"
$todoBucketId = "Mu8B-7xwVEmTX1H9mTlxFJgAD8mg"

Write-Host "Creating WordPress MCP Server task in Planner..." -ForegroundColor Yellow

# Create task body
$taskBody = @{
    planId = $planId
    bucketId = $todoBucketId
    title = "[CDA] Build WordPress MCP Server"
    priority = 3
} | ConvertTo-Json

$taskFile = "$env:TEMP\cda-wp-task.json"
$taskBody | Out-File -FilePath $taskFile -Encoding utf8 -NoNewline

# Create the task
$taskResult = & $azCmd rest --method POST `
    --uri "https://graph.microsoft.com/v1.0/planner/tasks" `
    --headers "Content-Type=application/json" `
    --body "@$taskFile" 2>&1 | Out-String

$task = $taskResult | ConvertFrom-Json

if (-not $task.id) {
    Write-Host "Failed to create task: $taskResult" -ForegroundColor Red
    Remove-Item $taskFile -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Created task: $($task.id)" -ForegroundColor Green

# Get task details for etag
Start-Sleep -Seconds 1
$detailsResult = & $azCmd rest --method GET --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.id)/details" 2>&1 | Out-String
$details = $detailsResult | ConvertFrom-Json
$detailsEtag = $details.'@odata.etag'

# Create comprehensive description
$description = @"
# WordPress MCP Server

Create a Model Context Protocol (MCP) server for WordPress that enables Claude Code to interact with WordPress sites.

## Requirements

### Core Features
1. **Authentication**
   - Support WordPress REST API authentication
   - Application passwords support
   - OAuth support (optional)

2. **Content Management**
   - Create, read, update, delete posts
   - Create, read, update, delete pages
   - Manage categories and tags
   - Upload and manage media

3. **User Management**
   - List users
   - Get user details
   - Create users (admin only)

4. **Plugin/Theme Management**
   - List installed plugins
   - Activate/deactivate plugins
   - List installed themes
   - Activate themes

5. **Site Settings**
   - Get site info
   - Update site settings

## Technical Implementation

### Project Structure
``````
wordpress-mcp-server/
├── src/
│   ├── index.ts           # Main server entry
│   ├── tools/             # MCP tool implementations
│   │   ├── posts.ts
│   │   ├── pages.ts
│   │   ├── media.ts
│   │   ├── users.ts
│   │   └── plugins.ts
│   ├── resources/         # MCP resources
│   ├── client/           # WordPress API client
│   └── types.ts          # TypeScript definitions
├── package.json
├── tsconfig.json
└── README.md
``````

### MCP Tools to Implement

1. **wp_get_posts** - List posts with filters
2. **wp_create_post** - Create new post
3. **wp_update_post** - Update existing post
4. **wp_delete_post** - Delete post
5. **wp_get_pages** - List pages
6. **wp_create_page** - Create new page
7. **wp_upload_media** - Upload media file
8. **wp_get_media** - Get media library
9. **wp_get_plugins** - List plugins
10. **wp_toggle_plugin** - Activate/deactivate plugin

### Configuration
Server should accept configuration via environment variables:
- WORDPRESS_URL: WordPress site URL
- WORDPRESS_USERNAME: Admin username
- WORDPRESS_PASSWORD: Application password

## Acceptance Criteria
- [ ] Server starts and registers with Claude Code
- [ ] Can list posts from WordPress
- [ ] Can create a new post
- [ ] Can upload media
- [ ] Error handling for API failures
- [ ] Documentation complete

## Output Location
Create the project in: C:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\wordpress-mcp-server

"@

# Update task details with description
$detailsBody = @{
    description = $description
} | ConvertTo-Json

$detailsFile = "$env:TEMP\cda-wp-details.json"
$detailsBody | Out-File -FilePath $detailsFile -Encoding utf8 -NoNewline

& $azCmd rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/planner/tasks/$($task.id)/details" `
    --headers "Content-Type=application/json" "If-Match=$detailsEtag" `
    --body "@$detailsFile" 2>&1 | Out-Null

Write-Host "Added task description" -ForegroundColor Green

# Cleanup
Remove-Item $taskFile -ErrorAction SilentlyContinue
Remove-Item $detailsFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Task Created Successfully ===" -ForegroundColor Cyan
Write-Host "Task ID: $($task.id)" -ForegroundColor White
Write-Host "Title: $($task.title)" -ForegroundColor White
