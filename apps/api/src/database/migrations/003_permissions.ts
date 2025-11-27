import { query } from '../client.js';

export async function up(): Promise<void> {
  // Add sudo access and permissions columns to users table
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS has_sudo BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb
  `);

  // Grant sudo to existing admin users
  await query(`
    UPDATE users SET has_sudo = true WHERE role = 'admin'
  `);

  // Create index for permissions
  await query(`CREATE INDEX IF NOT EXISTS idx_users_has_sudo ON users(has_sudo)`);
}

export async function down(): Promise<void> {
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS has_sudo`);
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS permissions`);
}
