/**
 * RemoteAuthService - Remote Claude CLI credential management
 *
 * Handles:
 * 1. Credential transfer from local to remote server
 * 2. Real-time credential status monitoring
 * 3. OAuth flow for direct token acquisition
 * 4. Token refresh management
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Client as SSHClient } from 'ssh2';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('remote-auth');

// ============================================
// Type Definitions
// ============================================

export interface RemoteTarget {
  type: 'ssh' | 'docker' | 'local';
  host?: string;
  port?: number;
  user?: string;
  privateKey?: string;
  privateKeyPath?: string;
  password?: string;
  containerId?: string;
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

export interface TransferResult {
  success: boolean;
  method: 'scp' | 'docker-cp' | 'direct';
  target: string;
  credentialsPath: string;
  message: string;
  timestamp: number;
}

export interface AuthStatus {
  authenticated: boolean;
  status: 'active' | 'expiring_soon' | 'expired' | 'not_authenticated';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: string;
  scopes?: string[];
  subscription?: string;
  rateLimitTier?: string;
  credentialsPath?: string;
}

export interface OAuthSession {
  sessionId: string;
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  authUrl: string;
  createdAt: number;
  expiresAt: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface SyncResult {
  success: boolean;
  direction: 'to-remote' | 'from-remote';
  source: AuthStatus;
  target: AuthStatus;
  message: string;
}

// ============================================
// OAuth Configuration
// ============================================

const OAUTH_CONFIG = {
  authorizationEndpoint: 'https://console.anthropic.com/oauth/authorize',
  tokenEndpoint: 'https://console.anthropic.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code']
};

// ============================================
// Remote Auth Service
// ============================================

export class RemoteAuthService extends EventEmitter {
  private localCredentialsPath: string;
  private pendingOAuthSessions: Map<string, OAuthSession> = new Map();
  private defaultRemoteTarget: RemoteTarget | null = null;

  constructor() {
    super();
    this.localCredentialsPath = this.getLocalCredentialsPath();
    this.loadDefaultTarget();
  }

  // ============================================
  // Path Helpers
  // ============================================

  private getLocalCredentialsPath(): string {
    const home = homedir();
    return join(home, '.claude', '.credentials.json');
  }

  private getRemoteCredentialsPath(): string {
    // Remote is typically Linux
    return '/root/.claude/.credentials.json';
  }

  private async loadDefaultTarget(): Promise<void> {
    // Load from environment or settings
    const host = process.env.REMOTE_SSH_HOST;
    const user = process.env.REMOTE_SSH_USER || 'root';
    const keyPath = process.env.REMOTE_SSH_KEY_PATH;

    if (host) {
      this.defaultRemoteTarget = {
        type: 'ssh',
        host,
        port: parseInt(process.env.REMOTE_SSH_PORT || '22', 10),
        user,
        privateKeyPath: keyPath
      };
      logger.info({ host, user }, 'Default remote target configured');
    }
  }

  // ============================================
  // Duration Formatting
  // ============================================

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

  // ============================================
  // Local Credential Operations
  // ============================================

  /**
   * Get credentials from local machine
   */
  async getLocalCredentials(): Promise<ClaudeCredentials | null> {
    try {
      const data = await fs.readFile(this.localCredentialsPath, 'utf-8');
      return JSON.parse(data) as ClaudeCredentials;
    } catch (err) {
      logger.debug({ err }, 'No local credentials found');
      return null;
    }
  }

  /**
   * Get detailed local auth status
   */
  async getLocalAuthStatus(): Promise<AuthStatus> {
    const creds = await this.getLocalCredentials();

    if (!creds || !creds.claudeAiOauth) {
      return {
        authenticated: false,
        status: 'not_authenticated',
        credentialsPath: this.localCredentialsPath
      };
    }

    const oauth = creds.claudeAiOauth;
    const now = Date.now();
    const expiresAt = oauth.expiresAt;
    const timeUntilExpiry = expiresAt - now;
    const isExpired = timeUntilExpiry < 0;
    const isExpiringSoon = !isExpired && timeUntilExpiry < 300000; // 5 minutes

    let status: AuthStatus['status'];
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
      expiresIn: isExpired
        ? `Expired ${this.formatDuration(-timeUntilExpiry)} ago`
        : this.formatDuration(timeUntilExpiry),
      scopes: oauth.scopes,
      subscription: oauth.subscriptionType,
      rateLimitTier: oauth.rateLimitTier,
      credentialsPath: this.localCredentialsPath
    };
  }

  /**
   * Write credentials to local file
   */
  async writeLocalCredentials(credentials: ClaudeCredentials): Promise<void> {
    const dir = join(homedir(), '.claude');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.localCredentialsPath,
      JSON.stringify(credentials, null, 2),
      { mode: 0o600 }
    );
    logger.info('Local credentials written');
    this.emit('credentials:local:updated', await this.getLocalAuthStatus());
  }

  // ============================================
  // Remote Credential Operations (SSH)
  // ============================================

  /**
   * Create SSH connection
   */
  private createSSHConnection(target: RemoteTarget): Promise<SSHClient> {
    return new Promise(async (resolve, reject) => {
      const client = new SSHClient();

      let privateKey: string | undefined;
      if (target.privateKey) {
        privateKey = target.privateKey;
      } else if (target.privateKeyPath) {
        try {
          privateKey = await fs.readFile(target.privateKeyPath, 'utf-8');
        } catch (err) {
          reject(new Error(`Failed to read private key: ${(err as Error).message}`));
          return;
        }
      }

      client.on('ready', () => {
        logger.debug({ host: target.host }, 'SSH connection established');
        resolve(client);
      });

      client.on('error', (err) => {
        logger.error({ err, host: target.host }, 'SSH connection error');
        reject(err);
      });

      client.connect({
        host: target.host,
        port: target.port || 22,
        username: target.user || 'root',
        privateKey,
        password: target.password
      });
    });
  }

  /**
   * Execute command on remote server via SSH
   */
  private async sshExec(client: SSHClient, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('data', (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        stream.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Command failed (${code}): ${errorOutput || output}`));
          } else {
            resolve(output);
          }
        });
      });
    });
  }

  /**
   * Get credentials from remote server
   */
  async getRemoteCredentials(target?: RemoteTarget): Promise<ClaudeCredentials | null> {
    const remoteTarget = target || this.defaultRemoteTarget;
    if (!remoteTarget) {
      throw new Error('No remote target configured');
    }

    if (remoteTarget.type === 'local') {
      return this.getLocalCredentials();
    }

    const client = await this.createSSHConnection(remoteTarget);

    try {
      const credentialsPath = this.getRemoteCredentialsPath();
      const output = await this.sshExec(client, `cat "${credentialsPath}" 2>/dev/null || echo "NOT_FOUND"`);

      if (output.trim() === 'NOT_FOUND') {
        return null;
      }

      return JSON.parse(output) as ClaudeCredentials;
    } finally {
      client.end();
    }
  }

  /**
   * Get detailed remote auth status
   */
  async getRemoteAuthStatus(target?: RemoteTarget): Promise<AuthStatus> {
    try {
      const creds = await this.getRemoteCredentials(target);

      if (!creds || !creds.claudeAiOauth) {
        return {
          authenticated: false,
          status: 'not_authenticated',
          credentialsPath: this.getRemoteCredentialsPath()
        };
      }

      const oauth = creds.claudeAiOauth;
      const now = Date.now();
      const expiresAt = oauth.expiresAt;
      const timeUntilExpiry = expiresAt - now;
      const isExpired = timeUntilExpiry < 0;
      const isExpiringSoon = !isExpired && timeUntilExpiry < 300000;

      let status: AuthStatus['status'];
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
        expiresIn: isExpired
          ? `Expired ${this.formatDuration(-timeUntilExpiry)} ago`
          : this.formatDuration(timeUntilExpiry),
        scopes: oauth.scopes,
        subscription: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
        credentialsPath: this.getRemoteCredentialsPath()
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get remote auth status');
      return {
        authenticated: false,
        status: 'not_authenticated',
        credentialsPath: this.getRemoteCredentialsPath()
      };
    }
  }

  /**
   * Write credentials to remote server via SFTP
   */
  async writeRemoteCredentials(credentials: ClaudeCredentials, target?: RemoteTarget): Promise<void> {
    const remoteTarget = target || this.defaultRemoteTarget;
    if (!remoteTarget) {
      throw new Error('No remote target configured');
    }

    if (remoteTarget.type === 'local') {
      await this.writeLocalCredentials(credentials);
      return;
    }

    const client = await this.createSSHConnection(remoteTarget);

    try {
      const credentialsPath = this.getRemoteCredentialsPath();
      const credentialsDir = credentialsPath.substring(0, credentialsPath.lastIndexOf('/'));

      // Ensure directory exists
      await this.sshExec(client, `mkdir -p "${credentialsDir}"`);

      // Write credentials using heredoc to avoid escaping issues
      const credentialsJson = JSON.stringify(credentials, null, 2);
      const escapedJson = credentialsJson.replace(/'/g, "'\\''");
      await this.sshExec(client, `echo '${escapedJson}' > "${credentialsPath}" && chmod 600 "${credentialsPath}"`);

      logger.info({ target: remoteTarget.host }, 'Remote credentials written');
      this.emit('credentials:remote:updated', await this.getRemoteAuthStatus(target));
    } finally {
      client.end();
    }
  }

  // ============================================
  // Credential Transfer
  // ============================================

  /**
   * Transfer credentials from local to remote
   */
  async transferCredentials(target?: RemoteTarget): Promise<TransferResult> {
    const remoteTarget = target || this.defaultRemoteTarget;
    if (!remoteTarget) {
      return {
        success: false,
        method: 'scp',
        target: 'unknown',
        credentialsPath: this.getRemoteCredentialsPath(),
        message: 'No remote target configured',
        timestamp: Date.now()
      };
    }

    logger.info({ target: remoteTarget.host }, 'Starting credential transfer');
    this.emit('transfer:started', { target: remoteTarget.host });

    try {
      // Get local credentials
      const localCreds = await this.getLocalCredentials();
      if (!localCreds) {
        return {
          success: false,
          method: 'scp',
          target: remoteTarget.host || 'local',
          credentialsPath: this.getRemoteCredentialsPath(),
          message: 'No local credentials found. Please authenticate Claude CLI locally first.',
          timestamp: Date.now()
        };
      }

      this.emit('transfer:progress', { progress: 30, message: 'Local credentials loaded' });

      // Check if local credentials are valid
      const localStatus = await this.getLocalAuthStatus();
      if (localStatus.status === 'expired') {
        return {
          success: false,
          method: 'scp',
          target: remoteTarget.host || 'local',
          credentialsPath: this.getRemoteCredentialsPath(),
          message: 'Local credentials are expired. Please re-authenticate locally.',
          timestamp: Date.now()
        };
      }

      this.emit('transfer:progress', { progress: 50, message: 'Connecting to remote...' });

      // Write to remote
      await this.writeRemoteCredentials(localCreds, remoteTarget);

      this.emit('transfer:progress', { progress: 90, message: 'Verifying remote credentials...' });

      // Verify remote
      const remoteStatus = await this.getRemoteAuthStatus(remoteTarget);

      const result: TransferResult = {
        success: remoteStatus.authenticated,
        method: remoteTarget.type === 'docker' ? 'docker-cp' : 'scp',
        target: remoteTarget.host || 'local',
        credentialsPath: this.getRemoteCredentialsPath(),
        message: remoteStatus.authenticated
          ? `Credentials transferred successfully. Expires in ${remoteStatus.expiresIn}`
          : 'Transfer completed but verification failed',
        timestamp: Date.now()
      };

      this.emit('transfer:complete', result);
      return result;
    } catch (err) {
      const result: TransferResult = {
        success: false,
        method: 'scp',
        target: remoteTarget.host || 'local',
        credentialsPath: this.getRemoteCredentialsPath(),
        message: `Transfer failed: ${(err as Error).message}`,
        timestamp: Date.now()
      };

      this.emit('transfer:error', result);
      return result;
    }
  }

  /**
   * Sync credentials between local and remote
   */
  async syncCredentials(direction: 'to-remote' | 'from-remote', target?: RemoteTarget): Promise<SyncResult> {
    const remoteTarget = target ?? this.defaultRemoteTarget ?? undefined;

    if (direction === 'to-remote') {
      const localStatus = await this.getLocalAuthStatus();
      const transferResult = await this.transferCredentials(remoteTarget);
      const remoteStatus = await this.getRemoteAuthStatus(remoteTarget);

      return {
        success: transferResult.success,
        direction,
        source: localStatus,
        target: remoteStatus,
        message: transferResult.message
      };
    } else {
      // from-remote
      const remoteCreds = await this.getRemoteCredentials(remoteTarget);
      if (!remoteCreds) {
        return {
          success: false,
          direction,
          source: await this.getRemoteAuthStatus(remoteTarget),
          target: await this.getLocalAuthStatus(),
          message: 'No remote credentials found'
        };
      }

      await this.writeLocalCredentials(remoteCreds);

      return {
        success: true,
        direction,
        source: await this.getRemoteAuthStatus(remoteTarget),
        target: await this.getLocalAuthStatus(),
        message: 'Credentials synced from remote to local'
      };
    }
  }

  // ============================================
  // OAuth Flow (PKCE)
  // ============================================

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge
   */
  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Build OAuth authorization URL
   */
  private buildAuthUrl(codeChallenge: string, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CONFIG.clientId,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      scope: OAUTH_CONFIG.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state
    });
    return `${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Start OAuth flow - returns URL for browser extension
   */
  startOAuthFlow(): OAuthSession {
    const sessionId = uuidv4();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = uuidv4();
    const authUrl = this.buildAuthUrl(codeChallenge, state);
    const now = Date.now();

    const session: OAuthSession = {
      sessionId,
      codeVerifier,
      codeChallenge,
      state,
      authUrl,
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000 // 10 minutes
    };

    this.pendingOAuthSessions.set(sessionId, session);
    logger.info({ sessionId }, 'OAuth session started');

    this.emit('oauth:started', {
      sessionId,
      authUrl,
      expiresAt: session.expiresAt
    });

    // Clean up expired sessions
    this.cleanupExpiredSessions();

    return session;
  }

  /**
   * Handle OAuth callback with tokens from extension
   */
  async handleOAuthCallback(sessionId: string, tokens: TokenResponse): Promise<AuthStatus> {
    const session = this.pendingOAuthSessions.get(sessionId);

    if (!session) {
      throw new Error('OAuth session not found or expired');
    }

    if (Date.now() > session.expiresAt) {
      this.pendingOAuthSessions.delete(sessionId);
      throw new Error('OAuth session expired');
    }

    logger.info({ sessionId }, 'Processing OAuth callback');

    // Convert tokens to credentials format
    const credentials: ClaudeCredentials = {
      claudeAiOauth: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scopes: OAUTH_CONFIG.scopes,
        subscriptionType: 'unknown', // Will be populated from API
        rateLimitTier: 'default'
      }
    };

    // Write credentials locally
    await this.writeLocalCredentials(credentials);

    // Transfer to remote if configured
    if (this.defaultRemoteTarget) {
      await this.writeRemoteCredentials(credentials, this.defaultRemoteTarget);
    }

    // Cleanup session
    this.pendingOAuthSessions.delete(sessionId);

    const status = await this.getLocalAuthStatus();
    this.emit('oauth:complete', status);

    return status;
  }

  /**
   * Cleanup expired OAuth sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.pendingOAuthSessions) {
      if (now > session.expiresAt) {
        this.pendingOAuthSessions.delete(sessionId);
        logger.debug({ sessionId }, 'Cleaned up expired OAuth session');
      }
    }
  }

  // ============================================
  // Verification
  // ============================================

  /**
   * Verify Claude CLI works on remote server
   */
  async verifyRemoteClaude(target?: RemoteTarget): Promise<{ success: boolean; output: string }> {
    const remoteTarget = target || this.defaultRemoteTarget;
    if (!remoteTarget) {
      throw new Error('No remote target configured');
    }

    const client = await this.createSSHConnection(remoteTarget);

    try {
      // Run a simple Claude command
      const output = await this.sshExec(
        client,
        'claude -p "Say hello in exactly 3 words" 2>&1 || echo "CLAUDE_FAILED"'
      );

      const success = !output.includes('CLAUDE_FAILED') && !output.includes('error');

      return { success, output: output.trim() };
    } finally {
      client.end();
    }
  }

  // ============================================
  // Configuration
  // ============================================

  /**
   * Set default remote target
   */
  setDefaultTarget(target: RemoteTarget): void {
    this.defaultRemoteTarget = target;
    logger.info({ target: target.host }, 'Default remote target updated');
  }

  /**
   * Get default remote target
   */
  getDefaultTarget(): RemoteTarget | null {
    return this.defaultRemoteTarget;
  }

  /**
   * Get OAuth session by ID
   */
  getOAuthSession(sessionId: string): OAuthSession | undefined {
    return this.pendingOAuthSessions.get(sessionId);
  }
}

// Singleton instance
export const remoteAuthService = new RemoteAuthService();
