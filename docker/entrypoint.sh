#!/bin/bash
set -e

echo "=== Claude Dev Automation - Starting All Services ==="

# Ensure directories exist with correct permissions
mkdir -p /run/postgresql /run/nginx /var/log/supervisor /data/postgres /data/redis /tmp/postgres

# Fix ownership
chown -R postgres:postgres /data/postgres /run/postgresql /tmp/postgres /var/log/supervisor
chmod 777 /var/log/supervisor
chown -R redis:redis /data/redis

# Initialize PostgreSQL if needed
if [ ! -f /data/postgres/PG_VERSION ]; then
    echo "Initializing PostgreSQL database..."
    su postgres -c "initdb -D /data/postgres"

    # Configure PostgreSQL
    echo "host all all 127.0.0.1/32 md5" >> /data/postgres/pg_hba.conf
    echo "host all all ::1/128 md5" >> /data/postgres/pg_hba.conf
    echo "listen_addresses = 'localhost'" >> /data/postgres/postgresql.conf
fi

# Start PostgreSQL temporarily to initialize database
echo "Starting PostgreSQL for initialization..."
su postgres -c "pg_ctl -D /data/postgres -l /tmp/postgres/postgresql-init.log start" || true

# Wait for PostgreSQL
for i in {1..30}; do
    if su postgres -c "pg_isready -h localhost" > /dev/null 2>&1; then
        echo "PostgreSQL is ready!"
        break
    fi
    echo "Waiting for PostgreSQL... ($i/30)"
    sleep 1
done

# Run database initialization
if [ -f /docker-entrypoint-initdb.d/init-db.sh ]; then
    echo "Running database initialization script..."
    /docker-entrypoint-initdb.d/init-db.sh || echo "Database init script failed, may already be initialized"
fi

# Stop PostgreSQL (supervisord will manage it)
echo "Stopping PostgreSQL (will be managed by supervisord)..."
su postgres -c "pg_ctl -D /data/postgres stop" || true

echo "=== Starting all services via Supervisord ==="
exec "$@"
