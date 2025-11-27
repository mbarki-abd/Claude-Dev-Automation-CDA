import { query, transaction } from '../client.js';
import { createChildLogger } from '../../utils/logger.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const logger = createChildLogger('user-repository');

export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  fullName?: string;
  role: 'admin' | 'user' | 'viewer';
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  unixUsername?: string;
  unixUid?: number;
  unixGid?: number;
  homeDirectory?: string;
  shell: string;
  avatarUrl?: string;
  timezone: string;
  locale: string;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  loginCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCredential {
  id: string;
  userId: string;
  provider: 'azure' | 'gcloud' | 'anthropic' | 'github' | 'aws';
  credentialType: 'oauth' | 'api_key' | 'service_account';
  credentialsEncrypted: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
  status: 'active' | 'expired' | 'revoked';
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  revoked: boolean;
  revokedAt?: Date;
  createdAt: Date;
}

export interface UserClaudeAuth {
  id: string;
  userId: string;
  authMethod: 'oauth' | 'api_key';
  oauthTokensEncrypted?: string;
  apiKeyEncrypted?: string;
  sessionKey?: string;
  expiresAt?: Date;
  status: 'active' | 'inactive' | 'expired';
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  fullName?: string;
  role?: 'admin' | 'user' | 'viewer';
}

export interface UpdateUserInput {
  email?: string;
  username?: string;
  fullName?: string;
  role?: 'admin' | 'user' | 'viewer';
  status?: 'active' | 'inactive' | 'suspended';
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
}

// Encryption key from environment
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

class UserRepository {
  private mapRowToUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      email: row.email as string,
      username: row.username as string,
      passwordHash: row.password_hash as string,
      fullName: row.full_name as string | undefined,
      role: row.role as 'admin' | 'user' | 'viewer',
      status: row.status as 'active' | 'inactive' | 'suspended' | 'pending',
      unixUsername: row.unix_username as string | undefined,
      unixUid: row.unix_uid as number | undefined,
      unixGid: row.unix_gid as number | undefined,
      homeDirectory: row.home_directory as string | undefined,
      shell: row.shell as string,
      avatarUrl: row.avatar_url as string | undefined,
      timezone: row.timezone as string,
      locale: row.locale as string,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : undefined,
      lastLoginIp: row.last_login_ip as string | undefined,
      loginCount: row.login_count as number,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await bcrypt.hash(input.password, 10);

    const result = await query(
      `INSERT INTO users (email, username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.email, input.username, passwordHash, input.fullName, input.role || 'user']
    );

    logger.info({ userId: result.rows[0].id, email: input.email }, 'User created');
    return this.mapRowToUser(result.rows[0]);
  }

  async findById(id: string): Promise<User | null> {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : null;
  }

  async findByUnixUsername(unixUsername: string): Promise<User | null> {
    const result = await query('SELECT * FROM users WHERE unix_username = $1', [unixUsername]);
    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : null;
  }

  async findAll(options: { page?: number; limit?: number; status?: string; role?: string } = {}): Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.status) {
      whereClause += ` WHERE status = $${paramIndex++}`;
      params.push(options.status);
    }

    if (options.role) {
      whereClause += whereClause ? ` AND role = $${paramIndex++}` : ` WHERE role = $${paramIndex++}`;
      params.push(options.role);
    }

    const countResult = await query(`SELECT COUNT(*) FROM users${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const result = await query(
      `SELECT * FROM users${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return {
      users: result.rows.map((row) => this.mapRowToUser(row)),
      total,
      page,
      limit,
    };
  }

  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      params.push(input.email);
    }
    if (input.username !== undefined) {
      updates.push(`username = $${paramIndex++}`);
      params.push(input.username);
    }
    if (input.fullName !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(input.fullName);
    }
    if (input.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      params.push(input.role);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(input.status);
    }
    if (input.avatarUrl !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      params.push(input.avatarUrl);
    }
    if (input.timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`);
      params.push(input.timezone);
    }
    if (input.locale !== undefined) {
      updates.push(`locale = $${paramIndex++}`);
      params.push(input.locale);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (result.rows[0]) {
      logger.info({ userId: id }, 'User updated');
      return this.mapRowToUser(result.rows[0]);
    }
    return null;
  }

  async updatePassword(id: string, newPassword: string): Promise<boolean> {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async recordLogin(id: string, ipAddress?: string): Promise<void> {
    await query(
      `UPDATE users SET last_login_at = NOW(), last_login_ip = $1, login_count = login_count + 1, updated_at = NOW() WHERE id = $2`,
      [ipAddress, id]
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM users WHERE id = $1', [id]);
    if ((result.rowCount ?? 0) > 0) {
      logger.info({ userId: id }, 'User deleted');
      return true;
    }
    return false;
  }

  // Unix account management
  async setUnixAccount(
    id: string,
    unixUsername: string,
    unixUid: number,
    unixGid: number,
    homeDirectory: string
  ): Promise<User | null> {
    const result = await query(
      `UPDATE users SET unix_username = $1, unix_uid = $2, unix_gid = $3, home_directory = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [unixUsername, unixUid, unixGid, homeDirectory, id]
    );
    return result.rows[0] ? this.mapRowToUser(result.rows[0]) : null;
  }

  async getNextUnixUid(): Promise<number> {
    const result = await query('SELECT MAX(unix_uid) as max_uid FROM users');
    const maxUid = result.rows[0]?.max_uid || 10000;
    return maxUid + 1;
  }

  // Credential management
  async saveCredential(
    userId: string,
    provider: string,
    credentialType: string,
    credentials: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    expiresAt?: Date
  ): Promise<UserCredential> {
    const encrypted = encrypt(JSON.stringify(credentials));

    const result = await query(
      `INSERT INTO user_credentials (user_id, provider, credential_type, credentials_encrypted, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider, credential_type)
       DO UPDATE SET credentials_encrypted = $4, metadata = $5, expires_at = $6, updated_at = NOW()
       RETURNING *`,
      [userId, provider, credentialType, encrypted, JSON.stringify(metadata || {}), expiresAt]
    );

    logger.info({ userId, provider, credentialType }, 'User credential saved');
    return this.mapRowToCredential(result.rows[0]);
  }

  async getCredential(userId: string, provider: string, credentialType: string): Promise<Record<string, unknown> | null> {
    const result = await query(
      `SELECT * FROM user_credentials WHERE user_id = $1 AND provider = $2 AND credential_type = $3`,
      [userId, provider, credentialType]
    );

    if (!result.rows[0]) return null;

    try {
      const decrypted = decrypt(result.rows[0].credentials_encrypted);
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error({ error, userId, provider }, 'Failed to decrypt credential');
      return null;
    }
  }

  async getUserCredentials(userId: string): Promise<UserCredential[]> {
    const result = await query(
      `SELECT * FROM user_credentials WHERE user_id = $1 ORDER BY provider, credential_type`,
      [userId]
    );
    return result.rows.map((row) => this.mapRowToCredential(row));
  }

  async deleteCredential(userId: string, provider: string, credentialType: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM user_credentials WHERE user_id = $1 AND provider = $2 AND credential_type = $3`,
      [userId, provider, credentialType]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToCredential(row: Record<string, unknown>): UserCredential {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      provider: row.provider as UserCredential['provider'],
      credentialType: row.credential_type as UserCredential['credentialType'],
      credentialsEncrypted: row.credentials_encrypted as string,
      metadata: row.metadata as Record<string, unknown> | undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
      status: row.status as UserCredential['status'],
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  // Session management
  async createSession(
    userId: string,
    refreshToken: string,
    expiresAt: Date,
    deviceInfo?: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<UserSession> {
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    const result = await query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, device_info, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, refreshTokenHash, expiresAt, JSON.stringify(deviceInfo || {}), ipAddress, userAgent]
    );

    return this.mapRowToSession(result.rows[0]);
  }

  async findValidSession(userId: string, refreshToken: string): Promise<UserSession | null> {
    const result = await query(
      `SELECT * FROM user_sessions WHERE user_id = $1 AND revoked = false AND expires_at > NOW()`,
      [userId]
    );

    for (const row of result.rows) {
      const isValid = await bcrypt.compare(refreshToken, row.refresh_token_hash);
      if (isValid) {
        return this.mapRowToSession(row);
      }
    }

    return null;
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const result = await query(
      `UPDATE user_sessions SET revoked = true, revoked_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllUserSessions(userId: string): Promise<number> {
    const result = await query(
      `UPDATE user_sessions SET revoked = true, revoked_at = NOW() WHERE user_id = $1 AND revoked = false`,
      [userId]
    );
    return result.rowCount ?? 0;
  }

  async getUserSessions(userId: string): Promise<UserSession[]> {
    const result = await query(
      `SELECT * FROM user_sessions WHERE user_id = $1 AND revoked = false AND expires_at > NOW() ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map((row) => this.mapRowToSession(row));
  }

  private mapRowToSession(row: Record<string, unknown>): UserSession {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      refreshTokenHash: row.refresh_token_hash as string,
      deviceInfo: row.device_info as Record<string, unknown> | undefined,
      ipAddress: row.ip_address as string | undefined,
      userAgent: row.user_agent as string | undefined,
      expiresAt: new Date(row.expires_at as string),
      revoked: row.revoked as boolean,
      revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    };
  }

  // Claude Auth management
  async saveClaudeAuth(
    userId: string,
    authMethod: 'oauth' | 'api_key',
    tokens?: { accessToken?: string; refreshToken?: string; expiresAt?: Date },
    apiKey?: string
  ): Promise<UserClaudeAuth> {
    const oauthTokensEncrypted = tokens ? encrypt(JSON.stringify(tokens)) : null;
    const apiKeyEncrypted = apiKey ? encrypt(apiKey) : null;

    const result = await query(
      `INSERT INTO user_claude_auth (user_id, auth_method, oauth_tokens_encrypted, api_key_encrypted, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (user_id)
       DO UPDATE SET auth_method = $2, oauth_tokens_encrypted = $3, api_key_encrypted = $4, expires_at = $5, status = 'active', updated_at = NOW()
       RETURNING *`,
      [userId, authMethod, oauthTokensEncrypted, apiKeyEncrypted, tokens?.expiresAt]
    );

    logger.info({ userId, authMethod }, 'Claude auth saved');
    return this.mapRowToClaudeAuth(result.rows[0]);
  }

  async getClaudeAuth(userId: string): Promise<{ auth: UserClaudeAuth; tokens?: Record<string, unknown>; apiKey?: string } | null> {
    const result = await query(`SELECT * FROM user_claude_auth WHERE user_id = $1`, [userId]);

    if (!result.rows[0]) return null;

    const auth = this.mapRowToClaudeAuth(result.rows[0]);
    let tokens: Record<string, unknown> | undefined;
    let apiKey: string | undefined;

    if (result.rows[0].oauth_tokens_encrypted) {
      try {
        tokens = JSON.parse(decrypt(result.rows[0].oauth_tokens_encrypted));
      } catch (e) {
        logger.error({ userId }, 'Failed to decrypt OAuth tokens');
      }
    }

    if (result.rows[0].api_key_encrypted) {
      try {
        apiKey = decrypt(result.rows[0].api_key_encrypted);
      } catch (e) {
        logger.error({ userId }, 'Failed to decrypt API key');
      }
    }

    return { auth, tokens, apiKey };
  }

  async deleteClaudeAuth(userId: string): Promise<boolean> {
    const result = await query(`DELETE FROM user_claude_auth WHERE user_id = $1`, [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToClaudeAuth(row: Record<string, unknown>): UserClaudeAuth {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      authMethod: row.auth_method as 'oauth' | 'api_key',
      oauthTokensEncrypted: row.oauth_tokens_encrypted as string | undefined,
      apiKeyEncrypted: row.api_key_encrypted as string | undefined,
      sessionKey: row.session_key as string | undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
      status: row.status as 'active' | 'inactive' | 'expired',
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  // Audit logging
  async logAudit(
    userId: string | null,
    action: string,
    resourceType?: string,
    resourceId?: string,
    details?: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await query(
      `INSERT INTO user_audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, resourceType, resourceId, JSON.stringify(details || {}), ipAddress, userAgent]
    );
  }
}

export const userRepository = new UserRepository();
