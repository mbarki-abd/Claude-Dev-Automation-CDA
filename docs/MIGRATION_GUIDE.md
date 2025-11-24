# Migration Guide: Docker → Native Deployment

## Quick Overview

**Current** (Docker everything):
- All components in containers (API, Dashboard, DB, Redis)
- Problem: No shell access for terminal/Claude CLI
- Error: `spawnSync /bin/sh ENOENT`

**New** (Native + Docker services):
- API runs natively with PM2
- Dashboard served by Nginx
- Only DB + Redis in Docker
- Full shell access, Claude CLI works

## Files Created

1. `docs/NATIVE_ARCHITECTURE.md` - Detailed architecture documentation
2. `infrastructure/docker-compose.native.yml` - Services only (PostgreSQL, Redis, Nginx)
3. `infrastructure/nginx.native.conf` - Reverse proxy configuration
4. `ecosystem.config.js` - PM2 process manager configuration
5. `scripts/setup-native-server.sh` - One-time server setup
6. `scripts/deploy-native.sh` - Deployment script

## Migration Steps

### Step 1: Backup Current System

```bash
# On Hetzner server
docker exec infrastructure-postgres-1 pg_dump -U postgres cda > /root/backup-$(date +%Y%m%d).sql
```

### Step 2: Stop Current Containers

```bash
cd /root/CDA/infrastructure
docker compose down
```

### Step 3: Setup Server (One-time)

```bash
cd /root/CDA
chmod +x scripts/setup-native-server.sh
./scripts/setup-native-server.sh
```

This installs:
- Node.js 20
- pnpm
- PM2
- Claude CLI

### Step 4: Start New Docker Services

```bash
cd /root/CDA/infrastructure
docker compose -f docker-compose.native.yml up -d
```

This starts:
- PostgreSQL (port 5432)
- Redis (port 6379)
- Nginx (ports 80, 443)

### Step 5: Restore Database

```bash
docker exec -i cda-postgres psql -U postgres cda < /root/backup-YYYYMMDD.sql
```

### Step 6: Build Application

```bash
cd /root/CDA
pnpm install
pnpm --filter @cda/shared build
pnpm --filter @cda/api build
pnpm --filter @cda/dashboard build
```

### Step 7: Start API with PM2

```bash
cd /root/CDA
pm2 start ecosystem.config.js
pm2 save
```

### Step 8: Deploy Dashboard

```bash
cp -r /root/CDA/apps/dashboard/dist/* /usr/share/nginx/html/
```

### Step 9: Test

```bash
# Check API
pm2 status
curl http://localhost:3000/api/health

# Check Dashboard
curl https://cda.ilinqsoft.com

# Check Terminal
# Visit https://cda.ilinqsoft.com/terminal
# Try: pwd, ls, echo "hello"
# Should work now!
```

## Configuration Changes Needed

### 1. Nginx Configuration

The Nginx container needs to access the native API. Update [nginx.native.conf](../infrastructure/nginx.native.conf) line 56:

```nginx
upstream api_backend {
    server host.docker.internal:3000;  # For Docker Desktop
    # OR
    server 172.17.0.1:3000;            # For Linux
}
```

### 2. Environment Variables

Create `/root/CDA/infrastructure/.env`:

```env
# PostgreSQL
POSTGRES_DB=cda
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password

# Redis
REDIS_PASSWORD=your_redis_password

# API (used by PM2)
ANTHROPIC_API_KEY=sk-your-key
```

### 3. Update Terminal Workspace

The workspace directory is already set to `/root/claude-workspace` in the code.

## Comparison

| Feature | Docker (Old) | Native (New) |
|---------|-------------|--------------|
| Shell access | ❌ No | ✅ Yes |
| Claude CLI | ❌ ENOENT | ✅ Works |
| Terminal commands | ❌ Failed | ✅ Works |
| Performance | Slower | Faster |
| Memory | ~500MB | ~100MB |
| Updates | Rebuild | `pm2 reload` |
| Debugging | Hard | Easy |
| PM2 cluster | ❌ No | ✅ Yes (2 inst) |

## Rollback Plan

If something goes wrong:

```bash
# Stop native services
pm2 delete cda-api
docker compose -f docker-compose.native.yml down

# Start old Docker setup
cd /root/CDA/infrastructure
docker compose up -d
```

## Advantages

1. **Terminal Works**: Native shell access
2. **Claude CLI Works**: Installed on host
3. **Better Performance**: No container overhead
4. **Easier Debugging**: Direct Node.js access
5. **Simple Updates**: `pm2 reload` (zero downtime)
6. **Keep Docker Benefits**: Easy database management
7. **PM2 Features**: Cluster mode, auto-restart, logging

## Post-Migration Checklist

- [ ] API responds at `https://cda.ilinqsoft.com/api/health`
- [ ] Dashboard loads at `https://cda.ilinqsoft.com`
- [ ] Terminal executes commands successfully
- [ ] Claude CLI authentication works
- [ ] Database connection works
- [ ] Redis connection works
- [ ] PM2 auto-restart on reboot configured
- [ ] Logs are being written to `/root/CDA/logs/`

## Monitoring

```bash
# PM2 status
pm2 status

# Live logs
pm2 logs cda-api

# Metrics
pm2 monit

# Docker services
docker ps

# Database
docker exec -it cda-postgres psql -U postgres -d cda
```

## Future Deployments

Just run:

```bash
cd /root/CDA
./scripts/deploy-native.sh
```

This will:
1. Pull latest code
2. Install dependencies
3. Build everything
4. Reload API (zero downtime)
5. Update dashboard

## Questions?

See full details in [NATIVE_ARCHITECTURE.md](./NATIVE_ARCHITECTURE.md)
