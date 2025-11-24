-- Fix tasks table schema to match TaskRepository
-- Drop old table (WARNING: data loss) and recreate with correct schema

DROP TABLE IF EXISTS execution_logs CASCADE;
DROP TABLE IF EXISTS proposals CASCADE;
DROP TABLE IF EXISTS executions CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;

-- Create tasks table with correct schema
CREATE TABLE tasks (
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

-- Create executions table
CREATE TABLE executions (
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

-- Create proposals table
CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  options JSONB DEFAULT '[]',
  selected_option VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create execution_logs table
CREATE TABLE execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_planner_id ON tasks(planner_id);
CREATE INDEX idx_executions_task_id ON executions(task_id);
CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_proposals_execution_id ON proposals(execution_id);
CREATE INDEX idx_proposals_status ON proposals(status);
CREATE INDEX idx_execution_logs_execution_id ON execution_logs(execution_id);
