import { query } from '../client.js';

export async function up(): Promise<void> {
  // Create tasks table
  await query(`
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
    )
  `);

  // Create executions table
  await query(`
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
    )
  `);

  // Create proposals table
  await query(`
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
    )
  `);

  // Create execution_logs table
  await query(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      stream VARCHAR(10) DEFAULT 'stdout',
      data TEXT NOT NULL
    )
  `);

  // Create settings table
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(255) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_planner_id ON tasks(planner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_proposals_task_id ON proposals(task_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id ON execution_logs(execution_id)`);
}

export async function down(): Promise<void> {
  await query(`DROP TABLE IF EXISTS execution_logs`);
  await query(`DROP TABLE IF EXISTS proposals`);
  await query(`DROP TABLE IF EXISTS executions`);
  await query(`DROP TABLE IF EXISTS tasks`);
  await query(`DROP TABLE IF EXISTS settings`);
}
