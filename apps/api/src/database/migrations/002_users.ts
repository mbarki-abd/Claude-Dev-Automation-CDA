import { query } from '../client.js';

export async function up(): Promise<void> {
  // Create users table
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      status VARCHAR(50) DEFAULT 'active',

      -- Unix account info
      unix_username VARCHAR(32) UNIQUE,
      unix_uid INTEGER UNIQUE,
      unix_gid INTEGER,
      home_directory VARCHAR(255),
      shell VARCHAR(100) DEFAULT '/bin/bash',

      -- Profile
      avatar_url VARCHAR(500),
      timezone VARCHAR(50) DEFAULT 'UTC',
      locale VARCHAR(10) DEFAULT 'en',

      -- Metadata
      last_login_at TIMESTAMP WITH TIME ZONE,
      last_login_ip VARCHAR(45),
      login_count INTEGER DEFAULT 0,

      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create user_credentials table for cloud and API credentials
  await query(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(50) NOT NULL,
      credential_type VARCHAR(50) NOT NULL,
      credentials_encrypted TEXT NOT NULL,
      metadata JSONB,
      expires_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) DEFAULT 'active',
      last_used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(user_id, provider, credential_type)
    )
  `);

  // Create user_sessions table for JWT refresh tokens
  await query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash VARCHAR(255) NOT NULL,
      device_info JSONB,
      ip_address VARCHAR(45),
      user_agent TEXT,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      revoked BOOLEAN DEFAULT FALSE,
      revoked_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create user_audit_logs table
  await query(`
    CREATE TABLE IF NOT EXISTS user_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50),
      resource_id VARCHAR(255),
      details JSONB,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create claude_auth table for per-user Claude authentication
  await query(`
    CREATE TABLE IF NOT EXISTS user_claude_auth (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      auth_method VARCHAR(50) DEFAULT 'oauth',
      oauth_tokens_encrypted TEXT,
      api_key_encrypted TEXT,
      session_key TEXT,
      expires_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) DEFAULT 'inactive',
      last_used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Add user_id to tasks table
  await query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);

  // Add user_id to executions table
  await query(`
    ALTER TABLE executions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);

  // Create indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_unix_username ON users(unix_username)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_credentials_provider ON user_credentials(provider)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token_hash)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_audit_logs_user_id ON user_audit_logs(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_audit_logs_action ON user_audit_logs(action)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_claude_auth_user_id ON user_claude_auth(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_executions_user_id ON executions(user_id)`);

  // Create admin user
  await query(`
    INSERT INTO users (email, username, password_hash, full_name, role, status, unix_username, home_directory)
    VALUES ('admin@cda.local', 'admin', '$2b$10$defaulthashwillbechanged', 'Administrator', 'admin', 'active', 'cda', '/home/cda')
    ON CONFLICT (email) DO NOTHING
  `);
}

export async function down(): Promise<void> {
  await query(`ALTER TABLE executions DROP COLUMN IF EXISTS user_id`);
  await query(`ALTER TABLE tasks DROP COLUMN IF EXISTS user_id`);
  await query(`DROP TABLE IF EXISTS user_claude_auth`);
  await query(`DROP TABLE IF EXISTS user_audit_logs`);
  await query(`DROP TABLE IF EXISTS user_sessions`);
  await query(`DROP TABLE IF EXISTS user_credentials`);
  await query(`DROP TABLE IF EXISTS users`);
}
