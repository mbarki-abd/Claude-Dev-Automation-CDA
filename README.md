# Claude Dev Automation (CDA)

A cloud-native web service that orchestrates development tasks from Microsoft Planner using Claude Code Terminal as the execution engine.

## Features

- **Planner Integration**: Automatically sync tasks from Microsoft Planner
- **AI-Powered Execution**: Uses Claude Code to execute development tasks
- **Real-Time Dashboard**: Monitor all operations with live terminal output
- **Proposal System**: Review and approve AI-generated decisions
- **Full CLI Access**: Pre-installed development tools in execution container
- **MCP Configuration**: Configurable Model Context Protocol servers

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Dashboard     │◄────│    API Server   │◄────│   Executor      │
│   (React)       │     │   (Fastify)     │     │   (Docker)      │
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
- Docker & Docker Compose
- PostgreSQL 15+ (or use Docker)
- Redis 7+ (or use Docker)

### Development Setup

1. Clone the repository:
```bash
git clone https://github.com/mbarki-abd/Claude-Dev-Automation-CDA.git
cd Claude-Dev-Automation-CDA
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy environment variables:
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. Start infrastructure with Docker:
```bash
cd infrastructure
docker-compose up -d postgres redis
```

5. Run database migrations:
```bash
pnpm db:migrate
```

6. Start development servers:
```bash
pnpm dev
```

The API will be available at http://localhost:3000 and the dashboard at http://localhost:5173.

### Using Docker Compose

To run the full stack with Docker:

```bash
cd infrastructure
docker-compose up -d
```

## Project Structure

```
claude-dev-automation/
├── apps/
│   ├── api/           # Backend API service (Fastify)
│   └── dashboard/     # Frontend React application
├── packages/
│   └── shared/        # Shared types and utilities
├── docker/            # Dockerfiles
├── infrastructure/    # Docker Compose & deployment configs
└── scripts/           # Utility scripts
```

## API Endpoints

### Tasks
- `GET /api/tasks` - List all tasks
- `GET /api/tasks/:id` - Get task details
- `POST /api/tasks` - Create task
- `PATCH /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/:id/execute` - Start execution
- `POST /api/tasks/:id/cancel` - Cancel execution

### Executions
- `GET /api/executions` - List executions
- `GET /api/executions/:id` - Get execution details
- `GET /api/executions/:id/logs` - Get execution logs

### Proposals
- `GET /api/proposals` - List proposals
- `GET /api/proposals/pending` - Get pending proposals
- `POST /api/proposals/:id/approve` - Approve proposal
- `POST /api/proposals/:id/reject` - Reject proposal

### Health
- `GET /api/health` - Full health check
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

## WebSocket Events

Connect to `/socket.io` for real-time updates:

### Server → Client
- `task:started` - Task execution began
- `task:output` - Terminal output
- `task:completed` - Task finished
- `task:failed` - Task failed
- `proposal:created` - New proposal

### Client → Server
- `task:cancel` - Request cancellation
- `proposal:resolve` - Approve proposal
- `terminal:resize` - Resize terminal
- `sync:trigger` - Manual Planner sync

## Environment Variables

```env
# API Configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://cda:cda@localhost:5432/cda

# Redis
REDIS_URL=redis://localhost:6379

# Microsoft 365 (for Planner integration)
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
PLANNER_PLAN_ID=your-plan-id

# Anthropic
ANTHROPIC_API_KEY=your-api-key

# GitHub
GITHUB_TOKEN=your-github-token

# Hetzner (optional)
HETZNER_API_TOKEN=your-hetzner-token
```

## Pre-installed CLI Tools (Executor Container)

- **Development**: claude, git, gh, node, npm, pnpm, python, pip, go
- **Cloud**: gcloud, hcloud, aws, az
- **Infrastructure**: docker, kubectl, terraform, ansible, helm
- **Remote**: ssh, scp, rsync
- **Utilities**: jq, yq, curl, wget, htop

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
