# Native Deployment Architecture

## Overview

This architecture runs the API and Dashboard natively on the Hetzner server while keeping PostgreSQL and Redis in Docker containers for easy management.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Hetzner Server (Ubuntu)                   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Internet (Port 443)                    │  │
│  └────────────────────────────┬─────────────────────────────┘  │
│                                │                                 │
│  ┌────────────────────────────▼─────────────────────────────┐  │
│  │              Nginx (Reverse Proxy + Static)               │  │
│  │                    cda.ilinqsoft.com                       │  │
│  │  - SSL Termination (Let's Encrypt)                        │  │
│  │  - Serves Dashboard (React SPA)                           │  │
│  │  - Proxies /api/* → localhost:3000                        │  │
│  └────────────────┬──────────────────────┬──────────────────┘  │
│                   │                       │                      │
│         ┌─────────▼─────────┐   ┌────────▼────────┐            │
│         │  Dashboard (SPA)  │   │   API (Native)  │            │
│         │  /usr/share/nginx │   │   Port 3000     │            │
│         │                   │   │   PM2 Managed   │            │
│         │  Built with:      │   │                 │            │
│         │  - React          │   │  Features:      │            │
│         │  - TypeScript     │   │  - Fastify      │            │
│         │  - Vite           │   │  - TypeScript   │            │
│         └───────────────────┘   │  - Terminal     │            │
│                                  │  - Claude CLI   │            │
│                                  │  - Auth         │            │
│                                  └─┬──────────┬────┘            │
│                                    │          │                 │
│              ┌─────────────────────┴──┐  ┌────┴──────────────┐ │
│              │                        │  │                    │ │
│   ┌──────────▼──────────┐  ┌─────────▼──▼─────┐  ┌──────────▼─┐
│   │  PostgreSQL         │  │  Redis            │  │ File System│
│   │  (Docker)           │  │  (Docker)         │  │            │
│   │  Port 5432          │  │  Port 6379        │  │ /root/     │
│   │                     │  │                   │  │  claude-   │
│   │  - User Data        │  │  - Sessions       │  │  workspace │
│   │  - Settings         │  │  - Cache          │  │            │
│   │  - Logs             │  │  - Queues         │  │ Logs:      │
│   │  - Backups          │  │                   │  │ /root/CDA/ │
│   └─────────────────────┘  └───────────────────┘  │  logs/     │
│                                                    └────────────┘
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Process Management                     │  │
│  │                                                            │  │
│  │  PM2 (API):                                               │  │
│  │  - 2 instances (cluster mode)                             │  │
│  │  - Auto-restart on crash                                  │  │
│  │  - Log rotation                                           │  │
│  │  - Memory limit: 1GB per instance                         │  │
│  │                                                            │  │
│  │  Docker Compose (Services):                               │  │
│  │  - PostgreSQL (always restart)                            │  │
│  │  - Redis (always restart)                                 │  │
│  │  - Nginx (always restart)                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Installed Tools                        │  │
│  │                                                            │  │
│  │  - Node.js 20                                             │  │
│  │  - pnpm (package manager)                                 │  │
│  │  - PM2 (process manager)                                  │  │
│  │  - Claude CLI (@anthropic-ai/claude-code)                │  │
│  │  - Git                                                    │  │
│  │  - Docker & Docker Compose                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
/root/
├── CDA/                              # Application root
│   ├── apps/
│   │   ├── api/
│   │   │   ├── src/                  # TypeScript source
│   │   │   └── dist/                 # Compiled JavaScript
│   │   └── dashboard/
│   │       ├── src/                  # React source
│   │       └── dist/                 # Production build
│   ├── packages/
│   │   └── shared/                   # Shared types & utils
│   ├── infrastructure/
│   │   ├── docker-compose.yml        # Services only
│   │   ├── nginx.conf                # Reverse proxy config
│   │   └── .env                      # Environment variables
│   ├── scripts/
│   │   ├── deploy.sh                 # Deployment script
│   │   ├── setup-server.sh           # Initial setup
│   │   └── backup.sh                 # Database backup
│   ├── logs/
│   │   ├── api-out.log              # PM2 stdout
│   │   ├── api-error.log            # PM2 stderr
│   │   ├── nginx-access.log         # Nginx access
│   │   └── nginx-error.log          # Nginx errors
│   ├── ecosystem.config.js           # PM2 configuration
│   └── package.json
│
├── claude-workspace/                 # Claude CLI workspace
│   └── (working files)
│
└── .pm2/                            # PM2 data
    ├── logs/
    ├── pids/
    └── pm2.log
```

## Component Details

### 1. Nginx (Reverse Proxy + Static Server)

**Role**: SSL termination, serve dashboard, proxy API requests

**Features**:
- HTTP/2 support
- Gzip compression
- Static file caching
- Security headers
- Rate limiting
- WebSocket support (for future features)

**Configuration Location**: `/root/CDA/infrastructure/nginx.conf`

**Ports**:
- 80 → Redirect to 443
- 443 → HTTPS

### 2. API (Native Node.js)

**Role**: Backend application server

**Technology Stack**:
- Fastify (web framework)
- TypeScript
- PostgreSQL (via pg)
- Redis (via ioredis)
- SSH2 (for Hetzner integration)

**Process Manager**: PM2
- Cluster mode: 2 instances
- Auto-restart on failure
- Log rotation (10 files, 10MB each)
- Memory limit: 1GB per instance

**Port**: 3000 (internal only)

**Environment Variables**:
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/cda
REDIS_URL=redis://localhost:6379
WORKSPACE_DIR=/root/claude-workspace
CLAUDE_CODE_PATH=claude
ANTHROPIC_API_KEY=sk-...
```

### 3. Dashboard (Static React SPA)

**Role**: Web interface

**Technology Stack**:
- React 18
- TypeScript
- Vite (build tool)
- React Router (SPA routing)

**Served by**: Nginx from `/usr/share/nginx/html`

**Build Process**:
1. `pnpm --filter @cda/dashboard build`
2. Output: `apps/dashboard/dist/`
3. Copy to: `/usr/share/nginx/html/`

### 4. PostgreSQL (Docker)

**Role**: Primary database

**Version**: 16-alpine

**Port**: 5432 (exposed to host)

**Volumes**:
- Data: `postgres-data:/var/lib/postgresql/data`
- Backups: `/root/backups/postgres/`

**Backup Strategy**:
- Daily automated backup at 2 AM
- Keep last 7 days
- Compressed SQL dumps

### 5. Redis (Docker)

**Role**: Cache, sessions, queues

**Version**: 7-alpine

**Port**: 6379 (exposed to host)

**Volumes**:
- Data: `redis-data:/data`

**Persistence**: AOF (Append Only File)

## Data Flow

### Request Flow (API)

```
Client Browser
    ↓
HTTPS Request (cda.ilinqsoft.com/api/*)
    ↓
Nginx (443)
    ↓ proxy_pass
API (localhost:3000)
    ↓
PostgreSQL/Redis (localhost:5432/6379)
    ↓
Response
    ↓
Client Browser
```

### Request Flow (Dashboard)

```
Client Browser
    ↓
HTTPS Request (cda.ilinqsoft.com/)
    ↓
Nginx (443)
    ↓ serve static
Dashboard Files (/usr/share/nginx/html)
    ↓
Client Browser (SPA)
    ↓ API calls
Back to Nginx → API
```

### Terminal Command Flow

```
User submits command in Dashboard
    ↓
POST /api/terminal/execute
    ↓
API receives request
    ↓
executeLocalCommand() - runs on HOST
    ↓ execSync(command)
Shell executes command on Hetzner server
    ↓ returns output
API returns result
    ↓
Dashboard displays output
```

### Claude CLI Flow

```
User requests Claude Code auth
    ↓
POST /api/cli-auth/claude-code/start
    ↓
API spawns 'claude' process on HOST
    ↓
Claude CLI runs natively
    ↓ auth URL detected
API returns session with URL
    ↓
User opens URL, completes auth
    ↓
Claude CLI saves credentials
    ↓ Session ready
Terminal can execute Claude commands
```

## Deployment Process

### Initial Setup (One-time)

1. **Install System Dependencies**
   ```bash
   # Run setup-server.sh
   - Node.js 20
   - pnpm
   - PM2
   - Docker & Docker Compose
   - Claude CLI
   ```

2. **Clone Repository**
   ```bash
   cd /root
   git clone <repo> CDA
   cd CDA
   ```

3. **Install Dependencies**
   ```bash
   pnpm install
   ```

4. **Build Application**
   ```bash
   pnpm --filter @cda/shared build
   pnpm --filter @cda/api build
   pnpm --filter @cda/dashboard build
   ```

5. **Start Services**
   ```bash
   # Start Docker services
   cd infrastructure
   docker compose up -d

   # Start API with PM2
   cd /root/CDA
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup  # Enable on boot
   ```

6. **Copy Dashboard**
   ```bash
   cp -r apps/dashboard/dist/* /usr/share/nginx/html/
   ```

### Regular Deployment (Updates)

```bash
cd /root/CDA
git pull
pnpm install
pnpm --filter @cda/shared build
pnpm --filter @cda/api build
pnpm --filter @cda/dashboard build
pm2 reload ecosystem.config.js
cp -r apps/dashboard/dist/* /usr/share/nginx/html/
```

Or simply: `./scripts/deploy.sh`

## Monitoring & Logs

### PM2 Monitoring

```bash
# View status
pm2 status

# View logs (live)
pm2 logs cda-api

# View logs (last 100 lines)
pm2 logs cda-api --lines 100

# View metrics
pm2 monit
```

### Nginx Logs

```bash
# Access logs
tail -f /root/CDA/logs/nginx-access.log

# Error logs
tail -f /root/CDA/logs/nginx-error.log
```

### Docker Service Logs

```bash
# PostgreSQL
docker logs infrastructure-postgres-1

# Redis
docker logs infrastructure-redis-1
```

## Security Considerations

### Network Security
- Firewall: Only ports 80, 443, 22 open
- SSL/TLS: Let's Encrypt certificates
- API: Only accessible via Nginx (not exposed directly)

### Application Security
- Environment variables: Stored in `.env` (not in Git)
- Database credentials: Strong passwords
- API rate limiting: Configured in Nginx
- CORS: Restricted to cda.ilinqsoft.com

### System Security
- Non-root user: API runs as PM2 user
- File permissions: Restricted access
- Regular updates: Automated security updates

## Backup Strategy

### Database Backup
```bash
# Daily backup at 2 AM
0 2 * * * /root/CDA/scripts/backup.sh
```

Backup script:
1. Dump PostgreSQL
2. Compress with gzip
3. Upload to cloud storage (optional)
4. Delete backups older than 7 days

### Configuration Backup
- `.env` files
- `nginx.conf`
- `ecosystem.config.js`
- PM2 configuration

Stored in separate Git repository (private).

## Performance Optimization

### API Performance
- PM2 cluster mode: 2 instances
- Redis caching: Frequently accessed data
- PostgreSQL connection pooling
- Gzip compression

### Dashboard Performance
- Build optimization: Vite production build
- Code splitting: Lazy loading routes
- Static asset caching: 1 year
- Gzip compression: Enabled in Nginx

### Database Performance
- PostgreSQL indexes: Optimized queries
- Connection pooling: Max 20 connections
- Vacuum: Automated maintenance

## Scalability

### Vertical Scaling (Current Server)
- Increase PM2 instances (currently 2)
- Upgrade server resources (CPU, RAM)
- Optimize PostgreSQL settings

### Horizontal Scaling (Future)
- Load balancer: Multiple API instances
- Database: Read replicas
- Redis: Cluster mode
- CDN: Static assets

## Rollback Strategy

### Quick Rollback
```bash
# If deployment fails
cd /root/CDA
git reset --hard HEAD~1
pnpm install
pnpm run build:all
pm2 reload ecosystem.config.js
```

### Database Rollback
```bash
# Restore from backup
pg_restore -d cda /root/backups/postgres/backup-YYYY-MM-DD.sql.gz
```

## Health Checks

### Automated Checks
- PM2: Auto-restart on crash
- Docker: Health checks for PostgreSQL/Redis
- Nginx: Upstream health checks

### Manual Checks
```bash
# API health
curl https://cda.ilinqsoft.com/api/health

# Database connection
pm2 logs cda-api | grep "Database connected"

# Redis connection
redis-cli ping
```

## Advantages Over Docker-Only Approach

1. **Full Shell Access**: Native Node.js can execute any command
2. **Claude CLI Works**: Installed directly on host
3. **Better Performance**: No Docker overhead for API
4. **Easier Debugging**: Direct access to Node.js process
5. **Simpler Updates**: Just `git pull` and `pm2 reload`
6. **Keep Docker Benefits**: For databases (easy backup, scaling)
7. **Standard Tools**: PM2, Nginx - battle-tested in production
8. **Lower Memory Usage**: No container overhead
9. **Direct File Access**: No volume mounting issues
10. **Native Process Management**: PM2 cluster mode

## Disadvantages (Mitigations)

1. **Less Isolation**: Mitigated by proper file permissions
2. **Manual Setup**: Automated with setup scripts
3. **Dependency Management**: Handled by pnpm
4. **Environment Differences**: Documented in setup script

## Cost Comparison

**Docker-Only**:
- Memory: ~500MB overhead (containers)
- CPU: ~10% overhead (virtualization)

**Native + Docker Services**:
- Memory: ~100MB overhead (Docker services only)
- CPU: ~2% overhead (minimal virtualization)

**Savings**: ~400MB RAM, ~8% CPU per server

## Migration Path

Current → Native deployment process is documented in `scripts/migrate-to-native.sh`
