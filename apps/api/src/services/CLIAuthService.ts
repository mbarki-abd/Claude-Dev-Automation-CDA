import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger.js';
import { settingsRepository } from '../database/repositories/SettingsRepository.js';

const logger = createChildLogger('cli-auth');

export interface AuthSession {
  id: string;
  tool: 'claude-code' | 'gcloud' | 'azure-cli';
  status: 'pending' | 'waiting_for_code' | 'authenticating' | 'success' | 'failed';
  authMethod?: 'device-code';
  authUrl?: string;
  userCode?: string;
  message?: string;
  createdAt: Date;
  expiresAt?: Date;
  sshStream?: any;
  sshConnection?: any;
}

export interface AuthProgress {
  sessionId: string;
  status: AuthSession['status'];
  authUrl?: string;
  userCode?: string;
  message?: string;
  output?: string;
}

export class CLIAuthService extends EventEmitter {
  private sessions: Map<string, AuthSession> = new Map();

  constructor() {
    super();
  }

  /**
   * Start Claude Code authentication flow via SSH PTY
   */
  async startClaudeCodeAuth(): Promise<AuthSession> {
    const sessionId = this.generateSessionId();
    const session: AuthSession = {
      id: sessionId,
      tool: 'claude-code',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    };
    this.sessions.set(sessionId, session);

    logger.info({ sessionId }, 'Starting Claude Code authentication');

    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();
      if (!hetznerSettings) {
        session.status = 'failed';
        session.message = 'Hetzner SSH not configured';
        this.emitProgress(session);
        return session;
      }

      const { Client } = await import('ssh2');
      const conn = new Client();

      session.sshConnection = conn;

      return new Promise((resolve) => {
        let buffer = '';
        let step = 0;
        let authUrl: string | null = null;

        const timeout = setTimeout(() => {
          session.status = 'failed';
          session.message = 'Authentication timeout (10 minutes)';
          this.emitProgress(session);
          conn.end();
          resolve(session);
        }, 10 * 60 * 1000);

        conn.on('ready', () => {
          logger.info({ sessionId }, 'SSH connected, starting Claude auth flow');

          conn.shell({ term: 'xterm-256color', cols: 120, rows: 40 }, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              session.status = 'failed';
              session.message = `Shell error: ${err.message}`;
              this.emitProgress(session);
              conn.end();
              resolve(session);
              return;
            }

            session.sshStream = stream;
            session.status = 'pending';
            this.emitProgress(session);

            stream.on('data', (data: Buffer) => {
              const str = data.toString();
              buffer += str;

              // Emit raw output for UI
              this.emit('output', { sessionId, data: str });

              // Extract OAuth URL
              const urlMatch = buffer.match(/https:\/\/claude\.ai\/oauth\/authorize[^\s\x1b\x00-\x1f]*/);
              if (urlMatch && !authUrl) {
                authUrl = urlMatch[0];
                session.authUrl = authUrl;
                session.status = 'waiting_for_code';
                session.message = 'Open the URL in your browser to authenticate';
                this.emitProgress(session);
                logger.info({ sessionId, authUrl }, 'Got Claude auth URL');
              }

              // Auto-navigate through menus
              if (buffer.includes('Choose the text style') && step === 0) {
                step = 1;
                setTimeout(() => stream.write('\r'), 1000);
              }

              if ((buffer.includes('Select login method') || buffer.includes('Choose an authentication method')) && step === 1) {
                step = 2;
                setTimeout(() => stream.write('\r'), 1500);
              }

              // Check for success
              if ((buffer.includes('Logged in') || buffer.includes('successfully authenticated') || buffer.includes('Welcome back')) && step >= 2) {
                clearTimeout(timeout);
                session.status = 'success';
                session.message = 'Claude Code authenticated successfully!';
                this.emitProgress(session);
                logger.info({ sessionId }, 'Claude Code authentication successful');

                // Exit gracefully
                setTimeout(() => {
                  stream.write('\x03'); // Ctrl+C
                  setTimeout(() => {
                    stream.write('exit\n');
                    conn.end();
                  }, 500);
                }, 2000);

                resolve(session);
              }

              // Check for errors
              if (buffer.includes('Invalid code') || buffer.includes('expired')) {
                session.message = 'Invalid or expired code - please try again';
                this.emitProgress(session);
              }
            });

            stream.on('close', () => {
              clearTimeout(timeout);
              if (session.status !== 'success') {
                session.status = 'failed';
                session.message = session.message || 'Session closed unexpectedly';
                this.emitProgress(session);
              }
              conn.end();
              resolve(session);
            });

            // Start Claude
            setTimeout(() => {
              stream.write('cd /root/claude-workspace && claude\n');
            }, 500);
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          session.status = 'failed';
          session.message = `SSH error: ${err.message}`;
          this.emitProgress(session);
          logger.error({ sessionId, err }, 'SSH connection error');
          resolve(session);
        });

        conn.connect({
          host: hetznerSettings.host,
          port: hetznerSettings.port || 22,
          username: hetznerSettings.username,
          password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
          privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
            ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
            : undefined,
          readyTimeout: 30000,
        });
      });
    } catch (err) {
      session.status = 'failed';
      session.message = `Error: ${(err as Error).message}`;
      this.emitProgress(session);
      logger.error({ sessionId, err }, 'Failed to start Claude auth');
      return session;
    }
  }

  /**
   * Submit auth code for an active session
   */
  async submitAuthCode(sessionId: string, code: string): Promise<{ success: boolean; message: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    if (session.status !== 'waiting_for_code') {
      return { success: false, message: `Cannot submit code in status: ${session.status}` };
    }

    if (!session.sshStream) {
      return { success: false, message: 'SSH stream not available' };
    }

    logger.info({ sessionId, codeLength: code.length }, 'Submitting auth code');
    session.status = 'authenticating';
    session.message = 'Submitting code...';
    this.emitProgress(session);

    // Send the code to the Claude CLI
    session.sshStream.write(code.trim() + '\r');

    return { success: true, message: 'Code submitted, waiting for authentication...' };
  }

  /**
   * Start Azure CLI device code flow
   */
  async startAzureAuth(): Promise<AuthSession> {
    const sessionId = this.generateSessionId();
    const session: AuthSession = {
      id: sessionId,
      tool: 'azure-cli',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    };
    this.sessions.set(sessionId, session);

    logger.info({ sessionId }, 'Starting Azure CLI device code authentication');

    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();
      const azureSettings = await settingsRepository.getAzureSettings();

      if (!hetznerSettings) {
        session.status = 'failed';
        session.message = 'Hetzner SSH not configured';
        this.emitProgress(session);
        return session;
      }

      const { Client } = await import('ssh2');
      const conn = new Client();

      return new Promise((resolve) => {
        let buffer = '';

        const timeout = setTimeout(() => {
          session.status = 'failed';
          session.message = 'Authentication timeout';
          this.emitProgress(session);
          conn.end();
          resolve(session);
        }, 15 * 60 * 1000);

        conn.on('ready', () => {
          // Use device code flow for interactive login
          const tenantArg = azureSettings?.tenantId ? ` --tenant ${azureSettings.tenantId}` : '';
          const command = `az login --use-device-code${tenantArg} 2>&1`;

          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              session.status = 'failed';
              session.message = `Exec error: ${err.message}`;
              this.emitProgress(session);
              conn.end();
              resolve(session);
              return;
            }

            stream.on('data', (data: Buffer) => {
              const str = data.toString();
              buffer += str;
              this.emit('output', { sessionId, data: str });

              // Look for device code URL and code
              const codeMatch = buffer.match(/enter the code\s+([A-Z0-9]+)\s+/i);
              const urlMatch = buffer.match(/https:\/\/microsoft\.com\/devicelogin/i);

              if (urlMatch && codeMatch && !session.authUrl) {
                session.authUrl = 'https://microsoft.com/devicelogin';
                session.userCode = codeMatch[1];
                session.status = 'waiting_for_code';
                session.message = `Enter code ${codeMatch[1]} at ${session.authUrl}`;
                this.emitProgress(session);
                logger.info({ sessionId, userCode: codeMatch[1] }, 'Got Azure device code');
              }

              // Check for success
              if (buffer.includes('"cloudName"') || buffer.includes('Successfully logged')) {
                clearTimeout(timeout);
                session.status = 'success';
                session.message = 'Azure CLI authenticated successfully!';
                this.emitProgress(session);
                logger.info({ sessionId }, 'Azure CLI authentication successful');
              }
            });

            stream.stderr.on('data', (data: Buffer) => {
              buffer += data.toString();
            });

            stream.on('close', (code: number) => {
              clearTimeout(timeout);
              if (session.status !== 'success') {
                session.status = code === 0 ? 'success' : 'failed';
                session.message = code === 0 ? 'Azure CLI authenticated!' : buffer.slice(-500);
              }
              this.emitProgress(session);
              conn.end();
              resolve(session);
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          session.status = 'failed';
          session.message = `SSH error: ${err.message}`;
          this.emitProgress(session);
          resolve(session);
        });

        conn.connect({
          host: hetznerSettings.host,
          port: hetznerSettings.port || 22,
          username: hetznerSettings.username,
          password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
          privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
            ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
            : undefined,
          readyTimeout: 30000,
        });
      });
    } catch (err) {
      session.status = 'failed';
      session.message = `Error: ${(err as Error).message}`;
      this.emitProgress(session);
      return session;
    }
  }

  /**
   * Start Google Cloud SDK device code flow
   */
  async startGCloudAuth(): Promise<AuthSession> {
    const sessionId = this.generateSessionId();
    const session: AuthSession = {
      id: sessionId,
      tool: 'gcloud',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
    this.sessions.set(sessionId, session);

    logger.info({ sessionId }, 'Starting gcloud authentication');

    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();
      const gcloudSettings = await settingsRepository.getGCloudSettings();

      if (!hetznerSettings) {
        session.status = 'failed';
        session.message = 'Hetzner SSH not configured';
        this.emitProgress(session);
        return session;
      }

      const { Client } = await import('ssh2');
      const conn = new Client();

      return new Promise((resolve) => {
        let buffer = '';

        const timeout = setTimeout(() => {
          session.status = 'failed';
          session.message = 'Authentication timeout';
          this.emitProgress(session);
          conn.end();
          resolve(session);
        }, 10 * 60 * 1000);

        conn.on('ready', () => {
          // Use gcloud auth login with no-browser flag for headless auth
          const projectArg = gcloudSettings?.projectId ? ` && gcloud config set project ${gcloudSettings.projectId}` : '';
          const command = `gcloud auth login --no-browser 2>&1${projectArg}`;

          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              session.status = 'failed';
              session.message = `Exec error: ${err.message}`;
              this.emitProgress(session);
              conn.end();
              resolve(session);
              return;
            }

            stream.on('data', (data: Buffer) => {
              const str = data.toString();
              buffer += str;
              this.emit('output', { sessionId, data: str });

              // Look for auth URL
              const urlMatch = buffer.match(/https:\/\/accounts\.google\.com\/o\/oauth2[^\s]*/);
              if (urlMatch && !session.authUrl) {
                session.authUrl = urlMatch[0];
                session.status = 'waiting_for_code';
                session.message = 'Open the URL in your browser and paste the code back';
                this.emitProgress(session);
                logger.info({ sessionId, authUrl: session.authUrl }, 'Got gcloud auth URL');
              }

              // Check for success
              if (buffer.includes('You are now logged in') || buffer.includes('You are now authenticated')) {
                clearTimeout(timeout);
                session.status = 'success';
                session.message = 'gcloud authenticated successfully!';
                this.emitProgress(session);
                logger.info({ sessionId }, 'gcloud authentication successful');
              }
            });

            stream.stderr.on('data', (data: Buffer) => {
              buffer += data.toString();
            });

            stream.on('close', (code: number) => {
              clearTimeout(timeout);
              if (session.status !== 'success') {
                session.status = code === 0 ? 'success' : 'failed';
                session.message = code === 0 ? 'gcloud authenticated!' : buffer.slice(-500);
              }
              this.emitProgress(session);
              conn.end();
              resolve(session);
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          session.status = 'failed';
          session.message = `SSH error: ${err.message}`;
          this.emitProgress(session);
          resolve(session);
        });

        conn.connect({
          host: hetznerSettings.host,
          port: hetznerSettings.port || 22,
          username: hetznerSettings.username,
          password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
          privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
            ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
            : undefined,
          readyTimeout: 30000,
        });
      });
    } catch (err) {
      session.status = 'failed';
      session.message = `Error: ${(err as Error).message}`;
      this.emitProgress(session);
      return session;
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): AuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AuthSession[] {
    const now = new Date();
    return Array.from(this.sessions.values())
      .filter(s => !s.expiresAt || s.expiresAt > now)
      .filter(s => s.status !== 'success' && s.status !== 'failed');
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.sshStream) {
      try {
        session.sshStream.write('\x03'); // Ctrl+C
        setTimeout(() => {
          session.sshStream?.write('exit\n');
        }, 500);
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (session.sshConnection) {
      try {
        session.sshConnection.end();
      } catch {
        // Ignore errors during cleanup
      }
    }

    session.status = 'failed';
    session.message = 'Session cancelled';
    this.emitProgress(session);
    logger.info({ sessionId }, 'Session cancelled');

    return true;
  }

  /**
   * Check auth status for all CLI tools
   */
  async checkAllAuthStatus(): Promise<Record<string, { authenticated: boolean; details?: string }>> {
    const hetznerSettings = await settingsRepository.getHetznerSettings();
    if (!hetznerSettings) {
      return {
        'claude-code': { authenticated: false, details: 'SSH not configured' },
        'azure-cli': { authenticated: false, details: 'SSH not configured' },
        'gcloud': { authenticated: false, details: 'SSH not configured' },
      };
    }

    const { Client } = await import('ssh2');

    return new Promise((resolve) => {
      const conn = new Client();
      const results: Record<string, { authenticated: boolean; details?: string }> = {};

      const timeout = setTimeout(() => {
        conn.end();
        resolve({
          'claude-code': { authenticated: false, details: 'Timeout' },
          'azure-cli': { authenticated: false, details: 'Timeout' },
          'gcloud': { authenticated: false, details: 'Timeout' },
        });
      }, 30000);

      conn.on('ready', () => {
        const checkCommand = `
echo "=== AUTH CHECK ==="
echo "CLAUDE:"
cat ~/.config/claude/config.json 2>/dev/null && echo "AUTHENTICATED" || echo "NOT_AUTHENTICATED"
echo "AZURE:"
az account show 2>/dev/null && echo "AUTHENTICATED" || echo "NOT_AUTHENTICATED"
echo "GCLOUD:"
gcloud auth list --filter="status=ACTIVE" --format="value(account)" 2>/dev/null | head -1 || echo "NOT_AUTHENTICATED"
echo "=== END ==="
`;

        conn.exec(checkCommand, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            resolve({
              'claude-code': { authenticated: false, details: err.message },
              'azure-cli': { authenticated: false, details: err.message },
              'gcloud': { authenticated: false, details: err.message },
            });
            return;
          }

          let output = '';
          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.stderr.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.on('close', () => {
            clearTimeout(timeout);
            conn.end();

            // Parse results
            const claudeAuth = output.includes('CLAUDE:') &&
              (output.split('CLAUDE:')[1]?.includes('AUTHENTICATED') &&
               !output.split('CLAUDE:')[1]?.split('AZURE:')[0]?.includes('NOT_AUTHENTICATED'));

            const azureAuth = output.includes('AZURE:') &&
              (output.split('AZURE:')[1]?.includes('AUTHENTICATED') &&
               !output.split('AZURE:')[1]?.split('GCLOUD:')[0]?.includes('NOT_AUTHENTICATED'));

            const gcloudSection = output.split('GCLOUD:')[1]?.split('===')[0] || '';
            const gcloudAuth = gcloudSection.trim().length > 0 && !gcloudSection.includes('NOT_AUTHENTICATED');

            results['claude-code'] = { authenticated: claudeAuth };
            results['azure-cli'] = { authenticated: azureAuth };
            results['gcloud'] = { authenticated: gcloudAuth, details: gcloudAuth ? gcloudSection.trim() : undefined };

            resolve(results);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          'claude-code': { authenticated: false, details: err.message },
          'azure-cli': { authenticated: false, details: err.message },
          'gcloud': { authenticated: false, details: err.message },
        });
      });

      conn.connect({
        host: hetznerSettings.host,
        port: hetznerSettings.port || 22,
        username: hetznerSettings.username,
        password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
        privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
          ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
          : undefined,
        readyTimeout: 10000,
      });
    });
  }

  private generateSessionId(): string {
    return `auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
  }
}

// Singleton instance
export const cliAuthService = new CLIAuthService();
