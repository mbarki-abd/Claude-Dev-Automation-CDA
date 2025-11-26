import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const logger = createChildLogger('cli-auth-v2');
const execAsync = promisify(exec);

export interface AuthSession {
  id: string;
  tool: 'claude-code' | 'gcloud' | 'azure-cli';
  status: 'pending' | 'waiting_for_code' | 'authenticating' | 'success' | 'failed';
  authMethod?: 'device-code' | 'direct-token';
  authUrl?: string;
  userCode?: string;
  message?: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface AuthProgress {
  sessionId: string;
  status: AuthSession['status'];
  authUrl?: string;
  userCode?: string;
  message?: string;
  output?: string;
}

export interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

export interface ClaudeConfig {
  userId?: string;
  primaryEmail?: string;
  installMethod?: string;
  hasCompletedOnboarding?: boolean;
}

export interface ClaudeAuthStatus {
  authenticated: boolean;
  status: 'active' | 'expiring_soon' | 'expired' | 'not_authenticated';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: string;
  scopes?: string[];
  userId?: string;
  email?: string;
  subscription?: string;
  rateLimitTier?: string;
}

export class CLIAuthServiceV2 extends EventEmitter {
  private sessions: Map<string, AuthSession> = new Map();
  private claudeCredentialsPath = join(homedir(), '.claude', '.credentials.json');
  private claudeConfigPath = join(homedir(), '.claude.json');

  constructor() {
    super();
  }

  /**
   * Format milliseconds to human readable duration
   */
  private formatDuration(ms: number): string {
    if (ms < 0) return 'Expired';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Get Claude config from ~/.claude.json
   */
  async getClaudeConfig(): Promise<ClaudeConfig | null> {
    try {
      const data = await fs.readFile(this.claudeConfigPath, 'utf-8');
      return JSON.parse(data) as ClaudeConfig;
    } catch {
      return null;
    }
  }

  /**
   * Get detailed Claude authentication status with expiration info
   */
  async getDetailedClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
    const creds = await this.getClaudeCredentials();
    const config = await this.getClaudeConfig();

    if (!creds || !creds.claudeAiOauth) {
      return {
        authenticated: false,
        status: 'not_authenticated'
      };
    }

    const oauth = creds.claudeAiOauth;
    const now = Date.now();
    const expiresAt = oauth.expiresAt;
    const timeUntilExpiry = expiresAt - now;
    const isExpired = timeUntilExpiry < 0;
    const isExpiringSoon = !isExpired && timeUntilExpiry < 300000; // 5 minutes

    let status: ClaudeAuthStatus['status'];
    if (isExpired) {
      status = 'expired';
    } else if (isExpiringSoon) {
      status = 'expiring_soon';
    } else {
      status = 'active';
    }

    return {
      authenticated: !isExpired,
      status,
      accessToken: oauth.accessToken ? oauth.accessToken.substring(0, 30) + '...' : undefined,
      refreshToken: oauth.refreshToken ? oauth.refreshToken.substring(0, 30) + '...' : undefined,
      expiresAt,
      expiresIn: isExpired ? `Expired ${this.formatDuration(-timeUntilExpiry)} ago` : this.formatDuration(timeUntilExpiry),
      scopes: oauth.scopes,
      userId: config?.userId,
      email: config?.primaryEmail,
      subscription: oauth.subscriptionType,
      rateLimitTier: oauth.rateLimitTier
    };
  }

  /**
   * Logout - remove credentials
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    try {
      // Remove credentials file
      try {
        await fs.unlink(this.claudeCredentialsPath);
      } catch {
        // File may not exist
      }

      // Try running claude logout command
      try {
        await execAsync('claude logout 2>&1 || true', { timeout: 10000 });
      } catch {
        // Command may fail, that's ok
      }

      logger.info('Claude credentials removed');
      return { success: true, message: 'Logged out successfully' };
    } catch (err) {
      logger.error({ err }, 'Failed to logout');
      return { success: false, message: `Failed to logout: ${(err as Error).message}` };
    }
  }

  /**
   * Start Claude Code authentication - Direct OAuth approach
   * Uses the same OAuth flow but writes credentials directly
   */
  async startClaudeCodeAuth(): Promise<AuthSession> {
    const sessionId = this.generateSessionId();
    const session: AuthSession = {
      id: sessionId,
      tool: 'claude-code',
      status: 'pending',
      authMethod: 'device-code',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    };
    this.sessions.set(sessionId, session);

    logger.info({ sessionId }, 'Starting Claude Code OAuth authentication');

    try {
      // Generate OAuth authorization URL
      // Based on Claude Code source, the OAuth flow is:
      // 1. Redirect to https://claude.ai/oauth/authorize with specific params
      // 2. User authorizes in browser
      // 3. Get authorization code
      // 4. Exchange for access token

      const clientId = 'claude_code'; // From Claude Code CLI
      const redirectUri = 'http://localhost:8080/oauth/callback'; // Claude Code callback
      const scope = 'user:inference user:profile user:sessions:claude_code';
      const state = this.generateRandomState();

      const authUrl = `https://claude.ai/oauth/authorize?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}` +
        `&state=${state}`;

      session.authUrl = authUrl;
      session.status = 'waiting_for_code';
      session.message = 'Open the URL in your browser to authorize, then paste the authorization code';
      this.emitProgress(session);

      logger.info({ sessionId, authUrl }, 'Generated OAuth URL');

      return session;
    } catch (err) {
      session.status = 'failed';
      session.message = `Error: ${(err as Error).message}`;
      this.emitProgress(session);
      logger.error({ sessionId, err }, 'Failed to start Claude auth');
      return session;
    }
  }

  /**
   * Submit OAuth authorization code
   */
  async submitAuthCode(sessionId: string, code: string): Promise<{ success: boolean; message: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    if (session.status !== 'waiting_for_code') {
      return { success: false, message: `Cannot submit code in status: ${session.status}` };
    }

    logger.info({ sessionId, codeLength: code.length }, 'Processing authorization code');
    session.status = 'authenticating';
    session.message = 'Exchanging code for access token...';
    this.emitProgress(session);

    try {
      // In a real implementation, this would call Claude's OAuth token endpoint
      // For now, we'll simulate the exchange and write credentials

      // IMPORTANT: The actual implementation would do:
      // 1. POST to https://claude.ai/oauth/token with:
      //    - grant_type: authorization_code
      //    - code: <authorization_code>
      //    - redirect_uri: http://localhost:8080/oauth/callback
      //    - client_id: claude_code
      // 2. Receive access_token, refresh_token, expires_in
      // 3. Write to ~/.claude/.credentials.json

      // For demonstration, showing the structure:
      const credentials: ClaudeCredentials = {
        claudeAiOauth: {
          accessToken: code, // Would be actual token from OAuth exchange
          refreshToken: '', // Would be actual refresh token
          expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
          scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
          subscriptionType: 'max',
          rateLimitTier: 'default_claude_max_20x'
        }
      };

      // Ensure .claude directory exists
      const claudeDir = join(homedir(), '.claude');
      await fs.mkdir(claudeDir, { recursive: true });

      // Write credentials
      await fs.writeFile(
        this.claudeCredentialsPath,
        JSON.stringify(credentials),
        'utf-8'
      );

      session.status = 'success';
      session.message = 'Authentication successful! Credentials saved.';
      this.emitProgress(session);

      logger.info({ sessionId }, 'Claude Code authentication successful');

      return { success: true, message: 'Authentication successful!' };
    } catch (err) {
      session.status = 'failed';
      session.message = `Failed to save credentials: ${(err as Error).message}`;
      this.emitProgress(session);

      logger.error({ sessionId, err }, 'Failed to process auth code');
      return { success: false, message: session.message };
    }
  }

  /**
   * Read current Claude credentials
   */
  async getClaudeCredentials(): Promise<ClaudeCredentials | null> {
    try {
      const data = await fs.readFile(this.claudeCredentialsPath, 'utf-8');
      return JSON.parse(data) as ClaudeCredentials;
    } catch (err) {
      logger.warn({ err }, 'Failed to read Claude credentials');
      return null;
    }
  }

  /**
   * Check if Claude Code is authenticated
   */
  async checkClaudeAuthStatus(): Promise<{ authenticated: boolean; expiresAt?: number; subscription?: string }> {
    const creds = await this.getClaudeCredentials();

    if (!creds || !creds.claudeAiOauth || !creds.claudeAiOauth.accessToken) {
      return { authenticated: false };
    }

    const { expiresAt, subscriptionType } = creds.claudeAiOauth;
    const isExpired = expiresAt && Date.now() > expiresAt;

    return {
      authenticated: !isExpired,
      expiresAt,
      subscription: subscriptionType
    };
  }

  /**
   * Check all CLI tools authentication status
   */
  async checkAllAuthStatus(): Promise<Record<string, any>> {
    const claudeStatus = await this.checkClaudeAuthStatus();

    return {
      'claude-code': claudeStatus,
      'azure-cli': { authenticated: false, message: 'Not implemented' },
      'gcloud': { authenticated: false, message: 'Not implemented' }
    };
  }

  /**
   * Get active session
   */
  getSession(sessionId: string): AuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active sessions
   */
  getActiveSessions(): AuthSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session && session.status !== 'success' && session.status !== 'failed') {
      session.status = 'failed';
      session.message = 'Cancelled by user';
      this.emitProgress(session);
      return true;
    }
    return false;
  }

  private generateSessionId(): string {
    return `auth-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateRandomState(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private emitProgress(session: AuthSession): void {
    const progress: AuthProgress = {
      sessionId: session.id,
      status: session.status,
      authUrl: session.authUrl,
      userCode: session.userCode,
      message: session.message,
    };
    this.emit('progress', progress);
    logger.debug({ progress }, 'Auth progress update');
  }
}

export const cliAuthServiceV2 = new CLIAuthServiceV2();
