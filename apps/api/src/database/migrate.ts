import 'dotenv/config';
import { query, closePool } from './client.js';
import { createChildLogger } from '../utils/logger.js';
import * as migration001 from './migrations/001_initial.js';
import * as migration002 from './migrations/002_users.js';
import * as migration003 from './migrations/003_permissions.js';

const logger = createChildLogger('migrations');

interface Migration {
  name: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

const migrations: Migration[] = [
  { name: '001_initial', ...migration001 },
  { name: '002_users', ...migration002 },
  { name: '003_permissions', ...migration003 },
];

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(): Promise<string[]> {
  const result = await query<{ name: string }>('SELECT name FROM migrations ORDER BY id');
  return result.rows.map((row) => row.name);
}

async function markMigrationExecuted(name: string): Promise<void> {
  await query('INSERT INTO migrations (name) VALUES ($1)', [name]);
}

async function markMigrationRolledBack(name: string): Promise<void> {
  await query('DELETE FROM migrations WHERE name = $1', [name]);
}

async function runMigrations(): Promise<void> {
  logger.info('Starting migrations...');

  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();

  for (const migration of migrations) {
    if (executed.includes(migration.name)) {
      logger.debug({ migration: migration.name }, 'Migration already executed, skipping');
      continue;
    }

    logger.info({ migration: migration.name }, 'Running migration');
    await migration.up();
    await markMigrationExecuted(migration.name);
    logger.info({ migration: migration.name }, 'Migration completed');
  }

  logger.info('All migrations completed');
}

async function rollbackMigration(): Promise<void> {
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();

  if (executed.length === 0) {
    logger.info('No migrations to rollback');
    return;
  }

  const lastMigration = executed[executed.length - 1];
  const migration = migrations.find((m) => m.name === lastMigration);

  if (!migration) {
    throw new Error(`Migration ${lastMigration} not found`);
  }

  logger.info({ migration: lastMigration }, 'Rolling back migration');
  await migration.down();
  await markMigrationRolledBack(lastMigration);
  logger.info({ migration: lastMigration }, 'Rollback completed');
}

const command = process.argv[2];

if (command === 'rollback') {
  rollbackMigration()
    .catch((error) => {
      logger.error({ error }, 'Rollback failed');
      process.exit(1);
    })
    .finally(() => closePool());
} else {
  runMigrations()
    .catch((error) => {
      logger.error({ error }, 'Migration failed');
      process.exit(1);
    })
    .finally(() => closePool());
}
