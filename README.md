# Claude Dev Automation (CDA)

A cloud-native web service that orchestrates development tasks from Microsoft Planner using Claude Code Terminal as the execution engine.

## Features

- **Planner Integration**: Automatically sync tasks from Microsoft Planner
- **AI-Powered Execution**: Uses Claude Code Terminal to execute development tasks
- **Real-Time Dashboard**: Monitor all operations with live terminal output
- **Proposal System**: Review and approve AI-generated decisions
- **Full CLI Access**: Pre-installed development tools in execution container
- **MCP Configuration**: Configurable Model Context Protocol servers

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Dashboard     │◄────│    API Server   │◄────│  Claude Code    │
│   (React)       │     │   (Fastify)     │     │   Terminal      │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
               ┌────▼────┐ ┌───▼───┐ ┌────▼────┐
               │PostgreSQL│ │ Redis │ │ Planner │
               └──────────┘ └───────┘ └─────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose (optional, for databases)
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

### 1. Clone and Install

```bash
git clone https://github.com/mbarki-abd/Claude-Dev-Automation-CDA.git
cd Claude-Dev-Automation-CDA
pnpm install
```

### 2. Configure Claude Code Terminal

Run the setup script:

```powershell
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts/setup-claude-code.ps1
```

This script will:
- Check if Claude Code CLI is installed
- Help you authenticate (Claude.ai account or API key)
- Configure MCP servers
- Save settings to `.env`

**Authentication Options:**

| Method | Description | Best For |
|--------|-------------|----------|
| **Claude.ai** | Uses your Claude.ai subscription | Most users - no API key needed |
| **API Key** | Uses Anthropic API directly | Enterprise/custom integrations |

### 3. Configure Microsoft 365 (Optional)

For Planner integration:

```powershell
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts/setup-microsoft365.ps1
```

This creates an Azure AD App Registration with the required permissions:
- User.Read
- Tasks.ReadWrite
- Tasks.Read
- Group.Read.All

### 4. Start Development

```bash
# Start both API and Dashboard
pnpm dev

# Or start individually
pnpm dev:api        # API at http://localhost:3000
pnpm dev:dashboard  # Dashboard at http://localhost:5173
```

### 5. (Optional) Start Databases with Docker

```bash
cd infrastructure
docker-compose up -d postgres redis
cd ..
pnpm db:migrate
```

## Claude Code Integration

### How It Works

CDA uses Claude Code Terminal as its execution engine:

1. **Tasks** are defined in Microsoft Planner (or created in dashboard)
2. **CDA** interprets tasks and creates execution plans
3. **Claude Code** executes the plans with full CLI access
4. **Output** streams in real-time to the dashboard
5. **Proposals** are generated when decisions are needed

### Authentication

#### Using Claude.ai Account (Recommended)

```bash
# Login to Claude.ai
claude login

# Your browser will open for authentication
# After login, CDA can use Claude Code automatically
```

#### Using API Key

1. Get API key from: https://console.anthropic.com/settings/keys
2. Set in `.env`:
```env
CLAUDE_CODE_AUTH=api-key
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Available Models

| Model | ID | Description |
|-------|-----|-------------|
| Claude Sonnet 4 | `claude-sonnet-4-20250514` | Default, best balance |
| Claude Opus 4 | `claude-opus-4-20250514` | Most capable |
| Claude Haiku | `claude-haiku-*` | Fastest, most economical |

Configure in `.env`:
```env
CLAUDE_CODE_MODEL=claude-sonnet-4-20250514
```

### MCP Servers

Claude Code supports MCP (Model Context Protocol) for extended capabilities:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

## Microsoft 365 / Planner Setup

### Step-by-Step Guide

1. **Run Setup Script**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-microsoft365.ps1
   ```

2. **Azure AD App Registration is created with:**
   - Redirect URIs for localhost
   - Microsoft Graph API permissions
   - Client secret (valid 2 years)

3. **Find Your Planner Plan ID**
   - Open: https://tasks.office.com
   - Navigate to your Plan
   - Copy Plan ID from URL: `...planId=<PLAN_ID>&...`

4. **Grant Admin Consent**
   - Script provides consent URL
   - Admin must approve API permissions

### Required Permissions

| Permission | Type | Description |
|------------|------|-------------|
| User.Read | Delegated | Read user profile |
| Tasks.ReadWrite | Delegated | Manage Planner tasks |
| Tasks.Read | Delegated | Read Planner tasks |
| Group.Read.All | Delegated | Read groups for plans |

## Project Structure

```
claude-dev-automation/
├── apps/
│   ├── api/                    # Backend API (Fastify)
│   │   └── src/
│   │       ├── routes/         # REST endpoints
│   │       ├── services/       # Business logic
│   │       │   ├── ClaudeCodeService.ts
│   │       │   └── RedisService.ts
│   │       └── database/       # PostgreSQL
│   └── dashboard/              # Frontend (React + Vite)
├── packages/
│   └── shared/                 # Shared types
├── scripts/
│   ├── setup-claude-code.ps1   # Claude Code setup
│   └── setup-microsoft365.ps1  # Azure AD setup
├── tests/
│   └── e2e/                    # Playwright tests
├── docker/                     # Dockerfiles
└── infrastructure/             # Docker Compose
```

## Environment Variables

```env
# ============================================
# CLAUDE CODE TERMINAL
# ============================================
CLAUDE_CODE_AUTH=claude-ai          # or "api-key"
# ANTHROPIC_API_KEY=sk-ant-...      # Only if api-key auth
CLAUDE_CODE_MODEL=claude-sonnet-4-20250514
CLAUDE_CODE_MAX_TOKENS=8192
CLAUDE_CODE_TIMEOUT=300000

# ============================================
# MICROSOFT 365 / AZURE AD
# ============================================
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
PLANNER_PLAN_ID=your-plan-id

# ============================================
# DATABASE & CACHE
# ============================================
DATABASE_URL=postgresql://cda:cda@localhost:5432/cda
REDIS_URL=redis://localhost:6379

# ============================================
# INTEGRATIONS
# ============================================
GITHUB_TOKEN=your-github-token
HETZNER_API_TOKEN=your-hetzner-token

# ============================================
# API
# ============================================
PORT=3000
NODE_ENV=development
```

## API Reference

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List all tasks |
| GET | `/api/tasks/:id` | Get task details |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/execute` | Start execution |
| POST | `/api/tasks/:id/cancel` | Cancel execution |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Full health check |
| GET | `/api/health/live` | Liveness probe |
| GET | `/api/health/ready` | Readiness probe |

## Testing

```bash
# Run E2E tests with Playwright
pnpm test:e2e

# Run with UI
pnpm test:e2e:ui

# Run headed (visible browser)
pnpm test:e2e:headed
```

## Troubleshooting

### Claude Code not authenticated

```bash
# Re-login to Claude.ai
claude login

# Or check API key
echo $ANTHROPIC_API_KEY
```

### Azure AD permission errors

1. Ensure admin consent was granted
2. Check App Registration in Azure Portal
3. Verify redirect URIs match your setup

### Database connection failed

```bash
# Start PostgreSQL with Docker
cd infrastructure
docker-compose up -d postgres
```

## Documentation Links

- **Claude Code**: https://docs.anthropic.com/claude-code
- **Claude API**: https://docs.anthropic.com/api
- **MCP Protocol**: https://modelcontextprotocol.io
- **Microsoft Graph**: https://learn.microsoft.com/graph/
- **Planner API**: https://learn.microsoft.com/graph/planner-concept-overview

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test:e2e`
5. Submit a pull request
