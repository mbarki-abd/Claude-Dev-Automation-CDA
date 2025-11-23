#!/bin/bash
set -e

# Wait for PostgreSQL to be ready
until pg_isready -U postgres -h localhost; do
    echo "Waiting for PostgreSQL to start..."
    sleep 2
done

# Create database and user if not exists
psql -U postgres -h localhost <<-EOSQL
    -- Create user if not exists
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'cda') THEN
            CREATE USER cda WITH PASSWORD 'cda_password';
        END IF;
    END
    \$\$;

    -- Create database if not exists
    SELECT 'CREATE DATABASE cda OWNER cda'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cda')\gexec

    -- Grant privileges
    GRANT ALL PRIVILEGES ON DATABASE cda TO cda;
EOSQL

# Connect to cda database and create tables
psql -U cda -h localhost -d cda <<-EOSQL
    -- Enable UUID extension
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- Tasks table (matches migration schema)
    CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        planner_id VARCHAR(255) UNIQUE,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        type VARCHAR(50) DEFAULT 'development',
        status VARCHAR(50) DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        complexity VARCHAR(20),
        estimated_duration VARCHAR(50),
        interpretation JSONB,
        execution_plan JSONB,
        required_tools TEXT[],
        mcp_servers TEXT[],
        prerequisites JSONB,
        planner_bucket VARCHAR(255),
        planner_labels TEXT[],
        assigned_to VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE
    );

    -- Executions table (matches migration schema)
    CREATE TABLE IF NOT EXISTS executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'running',
        container_id VARCHAR(255),
        output TEXT,
        error TEXT,
        exit_code INTEGER,
        duration_ms INTEGER,
        artifacts JSONB,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE
    );

    -- Proposals table (matches migration schema)
    CREATE TABLE IF NOT EXISTS proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        execution_id UUID REFERENCES executions(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        options JSONB NOT NULL,
        recommendation VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        resolution VARCHAR(100),
        resolved_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        resolved_at TIMESTAMP WITH TIME ZONE
    );

    -- Execution logs table
    CREATE TABLE IF NOT EXISTS execution_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        stream VARCHAR(10) DEFAULT 'stdout',
        data TEXT NOT NULL
    );

    -- Settings table
    CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_planner_id ON tasks(planner_id);
    CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_task_id ON proposals(task_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id ON execution_logs(execution_id);

    -- Update trigger function
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS \$\$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    \$\$ language 'plpgsql';

    -- Create trigger for tasks
    DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
    CREATE TRIGGER update_tasks_updated_at
        BEFORE UPDATE ON tasks
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
EOSQL

echo "Database initialization completed!"
