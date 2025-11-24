import { query } from '../client.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('settings-repository');

export interface Setting {
  key: string;
  value: Record<string, unknown>;
  updated_at: Date;
}

// Settings keys
export const SETTINGS_KEYS = {
  AZURE: 'azure',
  GITHUB: 'github',
  GCLOUD: 'gcloud',
  CLAUDE: 'claude',
  PLANNER: 'planner',
  GENERAL: 'general',
  HETZNER: 'hetzner',
} as const;

export class SettingsRepository {
  async get(key: string): Promise<Setting | null> {
    const result = await query<Setting>(
      'SELECT key, value, updated_at FROM settings WHERE key = $1',
      [key]
    );
    return result.rows[0] || null;
  }

  async getAll(): Promise<Setting[]> {
    const result = await query<Setting>(
      'SELECT key, value, updated_at FROM settings ORDER BY key'
    );
    return result.rows;
  }

  async set(key: string, value: Record<string, unknown>): Promise<Setting> {
    const result = await query<Setting>(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()
       RETURNING key, value, updated_at`,
      [key, JSON.stringify(value)]
    );
    logger.info({ key }, 'Setting updated');
    return result.rows[0];
  }

  async delete(key: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM settings WHERE key = $1',
      [key]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // Helper to get typed settings
  async getAzureSettings(): Promise<AzureSettings | null> {
    const setting = await this.get(SETTINGS_KEYS.AZURE);
    return setting?.value as unknown as AzureSettings | null;
  }

  async getGitHubSettings(): Promise<GitHubSettings | null> {
    const setting = await this.get(SETTINGS_KEYS.GITHUB);
    return setting?.value as unknown as GitHubSettings | null;
  }

  async getGCloudSettings(): Promise<GCloudSettings | null> {
    const setting = await this.get(SETTINGS_KEYS.GCLOUD);
    return setting?.value as unknown as GCloudSettings | null;
  }

  async getClaudeSettings(): Promise<ClaudeSettings | null> {
    const setting = await this.get(SETTINGS_KEYS.CLAUDE);
    return setting?.value as unknown as ClaudeSettings | null;
  }

  async getPlannerSettings(): Promise<PlannerSettings | null> {
    const setting = await this.get(SETTINGS_KEYS.PLANNER);
    return setting?.value as unknown as PlannerSettings | null;
  }

  async getHetznerSettings(): Promise<HetznerSettings | null> {
    const setting = await this.get(SETTINGS_KEYS.HETZNER);
    return setting?.value as unknown as HetznerSettings | null;
  }
}

// Type definitions for settings
export interface AzureSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  configured: boolean;
}

export interface GitHubSettings {
  token: string;
  username: string;
  defaultRepo: string;
  configured: boolean;
}

export interface GCloudSettings {
  projectId: string;
  region: string;
  credentials: string; // JSON string or path
  configured: boolean;
}

export interface ClaudeSettings {
  authMethod: 'claude-ai' | 'api-key';
  apiKey?: string;
  model: string;
  configured: boolean;
}

export interface PlannerSettings {
  planId: string;
  syncInterval: number; // minutes
  autoSync: boolean;
  buckets: {
    todo: string;
    inProgress: string;
    done: string;
  };
  configured: boolean;
}

export interface HetznerSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  sshKeyPath?: string;
  authMethod: 'password' | 'ssh-key';
  configured: boolean;
}

export const settingsRepository = new SettingsRepository();
