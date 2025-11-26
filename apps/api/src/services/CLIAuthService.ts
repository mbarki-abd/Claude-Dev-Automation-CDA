import { EventEmitter } from 'events';
import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createChildLogger } from '../utils/logger.js';
import * as nodePty from 'node-pty';

const logger = createChildLogger('cli-auth');
const execAsync = promisify(exec);
const pty = nodePty;

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
  process?: ChildProcess | nodePty.IPty;
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
   * Start Claude Code authentication flow (local execution with PTY)
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

    logger.info({ sessionId }, 'Starting Claude Code authentication with PTY');

    try {
      // Ensure workspace exists
      await execAsync('mkdir -p /tmp/claude-workspace');

      // Use PTY for proper interactive Claude CLI
      const proc = pty.spawn('claude', [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: '/tmp/claude-workspace',
        env: {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin',
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
        },
      });

      session.process = proc;
      let buffer = '';
      let step = 0;

      const timeout = setTimeout(() => {
        session.status = 'failed';
        session.message = 'Authentication timeout (10 minutes)';
        this.emitProgress(session);
        proc.kill();
      }, 10 * 60 * 1000);

      // PTY data handler
      proc.onData((data: string) => {
        buffer += data;
        this.emit('output', { sessionId: session.id, data });

        // Extract OAuth URL
        const urlMatch = buffer.match(/https:\/\/claude\.ai\/oauth\/authorize[^\s\x1b\x00-\x1f]*/);
        if (urlMatch && !session.authUrl) {
          session.authUrl = urlMatch[0];
          session.status = 'waiting_for_code';
          session.message = 'Open the URL in your browser to authenticate';
          this.emitProgress(session);
          logger.info({ sessionId: session.id, authUrl: session.authUrl }, 'Got Claude auth URL');
        }

        // Auto-navigate through menus
        if (buffer.includes('Choose the text style') && step === 0) {
          step = 1;
          setTimeout(() => proc.write('\r'), 1000);
        }

        if ((buffer.includes('Select login method') || buffer.includes('Choose an authentication method')) && step === 1) {
          step = 2;
          setTimeout(() => proc.write('\r'), 1500);
        }

        // Check for success
        if ((buffer.includes('Logged in') || buffer.includes('successfully authenticated') || buffer.includes('Welcome back')) && step >= 2) {
          clearTimeout(timeout);
          session.status = 'success';
          session.message = 'Claude Code authenticated successfully!';
          this.emitProgress(session);
          logger.info({ sessionId: session.id }, 'Claude Code authentication successful');

          setTimeout(() => {
            proc.write('\x03'); // Ctrl+C
          }, 2000);
        }
      });

      proc.onExit(({ exitCode }: { exitCode: number }) => {
        clearTimeout(timeout);
        if (session.status !== 'success') {
          session.status = 'failed';
          session.message = session.message || `Process exited with code ${exitCode}`;
        }
        this.emitProgress(session);
        logger.info({ sessionId: session.id, exitCode }, 'Claude auth process exited');
      });

      // Wait for auth URL or timeout
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (session.authUrl || session.status === 'failed' || session.status === 'success') {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);

        // Max wait 60 seconds for URL (increased from 30)
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 60000);
      });

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

    if (!session.process) {
      return { success: false, message: 'Process not available' };
    }

    logger.info({ sessionId, codeLength: code.length }, 'Submitting auth code');
    session.status = 'authenticating';
    session.message = 'Submitting code...';
    this.emitProgress(session);

    // Send the code to the process - handle both PTY and regular process
    const proc = session.process as nodePty.IPty;
    if (typeof proc.write === 'function') {
      // PTY process - use write directly
      proc.write(code.trim() + '\r');
    } else {
      // Regular process - use stdin
      const regularProc = session.process as ChildProcess;
      regularProc.stdin?.write(code.trim() + '\n');
    }

    return { success: true, message: 'Code submitted, waiting for authentication...' };
  }

  /**
   * Start Azure CLI device code flow (local execution)
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

    logger.info({ sessionId }, 'Starting Azure CLI device code authentication (local)');

    try {
      const childProcess = spawn('az', ['login', '--use-device-code'], {
        shell: true,
        env: process.env,
      });

      session.process = childProcess;
      let buffer = '';

      const timeout = setTimeout(() => {
        session.status = 'failed';
        session.message = 'Authentication timeout';
        this.emitProgress(session);
        childProcess.kill();
      }, 15 * 60 * 1000);

      childProcess.stdout?.on('data', (data: Buffer) => {
        const str = data.toString();
        buffer += str;
        this.emit('output', { sessionId: session.id, data: str });

        // Look for device code URL and code
        const codeMatch = buffer.match(/enter the code\s+([A-Z0-9]+)\s+/i);
        const urlMatch = buffer.match(/https:\/\/microsoft\.com\/devicelogin/i);

        if (urlMatch && codeMatch && !session.authUrl) {
          session.authUrl = 'https://microsoft.com/devicelogin';
          session.userCode = codeMatch[1];
          session.status = 'waiting_for_code';
          session.message = `Enter code ${codeMatch[1]} at ${session.authUrl}`;
          this.emitProgress(session);
          logger.info({ sessionId: session.id, userCode: codeMatch[1] }, 'Got Azure device code');
        }

        // Check for success
        if (buffer.includes('"cloudName"') || buffer.includes('Successfully logged')) {
          clearTimeout(timeout);
          session.status = 'success';
          session.message = 'Azure CLI authenticated successfully!';
          this.emitProgress(session);
          logger.info({ sessionId: session.id }, 'Azure CLI authentication successful');
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        buffer += data.toString();
        this.emit('output', { sessionId: session.id, data: data.toString() });
      });

      childProcess.on('close', (code: number) => {
        clearTimeout(timeout);
        if (session.status !== 'success') {
          session.status = code === 0 ? 'success' : 'failed';
          session.message = code === 0 ? 'Azure CLI authenticated!' : buffer.slice(-500);
        }
        this.emitProgress(session);
      });

      childProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        session.status = 'failed';
        session.message = `Process error: ${err.message}`;
        this.emitProgress(session);
      });

      // Wait for device code or timeout
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (session.userCode || session.status === 'failed' || session.status === 'success') {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 30000);
      });

      return session;
    } catch (err) {
      session.status = 'failed';
      session.message = `Error: ${(err as Error).message}`;
      this.emitProgress(session);
      return session;
    }
  }

  /**
   * Start Google Cloud SDK device code flow (local execution)
   * Uses --no-launch-browser which works on headless servers
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

    logger.info({ sessionId }, 'Starting gcloud authentication (local)');

    try {
      // Use --no-launch-browser instead of --no-browser
      // This provides a URL that shows the auth code in the browser (no redirect needed)
      const childProcess = spawn('gcloud', ['auth', 'login', '--no-launch-browser'], {
        shell: true,
        env: process.env,
      });

      session.process = childProcess;
      let buffer = '';

      const timeout = setTimeout(() => {
        session.status = 'failed';
        session.message = 'Authentication timeout';
        this.emitProgress(session);
        childProcess.kill();
      }, 10 * 60 * 1000);

      childProcess.stdout?.on('data', (data: Buffer) => {
        const str = data.toString();
        buffer += str;
        this.emit('output', { sessionId: session.id, data: str });

        // Look for auth URL
        const urlMatch = buffer.match(/https:\/\/accounts\.google\.com\/o\/oauth2[^\s]*/);
        if (urlMatch && !session.authUrl) {
          session.authUrl = urlMatch[0];
          session.status = 'waiting_for_code';
          session.message = 'Open the URL in your browser and paste the code back';
          this.emitProgress(session);
          logger.info({ sessionId: session.id, authUrl: session.authUrl }, 'Got gcloud auth URL');
        }

        // Check for success
        if (buffer.includes('You are now logged in') || buffer.includes('You are now authenticated')) {
          clearTimeout(timeout);
          session.status = 'success';
          session.message = 'gcloud authenticated successfully!';
          this.emitProgress(session);
          logger.info({ sessionId: session.id }, 'gcloud authentication successful');
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        buffer += data.toString();
        this.emit('output', { sessionId: session.id, data: data.toString() });
      });

      childProcess.on('close', (code: number) => {
        clearTimeout(timeout);
        if (session.status !== 'success') {
          session.status = code === 0 ? 'success' : 'failed';
          session.message = code === 0 ? 'gcloud authenticated!' : buffer.slice(-500);
        }
        this.emitProgress(session);
      });

      childProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        session.status = 'failed';
        session.message = `Process error: ${err.message}`;
        this.emitProgress(session);
      });

      // Wait for auth URL or timeout
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (session.authUrl || session.status === 'failed' || session.status === 'success') {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 30000);
      });

      return session;
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

    if (session.process) {
      try {
        // Handle both PTY and regular process
        const proc = session.process as nodePty.IPty;
        if (typeof proc.write === 'function') {
          // PTY process
          proc.write('\x03'); // Ctrl+C
          setTimeout(() => proc.kill(), 500);
        } else {
          // Regular process
          const regularProc = session.process as ChildProcess;
          regularProc.stdin?.write('\x03');
          setTimeout(() => regularProc.kill(), 500);
        }
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
   * Check auth status for all CLI tools (local execution)
   */
  async checkAllAuthStatus(): Promise<Record<string, { authenticated: boolean; details?: string }>> {
    const results: Record<string, { authenticated: boolean; details?: string }> = {
      'claude-code': { authenticated: false },
      'azure-cli': { authenticated: false },
      'gcloud': { authenticated: false },
    };

    // Check Claude Code - check credentials file at ~/.claude/.credentials.json
    try {
      const { stdout } = await execAsync('cat ~/.claude/.credentials.json 2>/dev/null || cat /root/.claude/.credentials.json 2>/dev/null', { timeout: 5000 });
      if (stdout.length > 10) {
        const creds = JSON.parse(stdout);
        if (creds.claudeAiOauth?.accessToken) {
          const isExpired = creds.claudeAiOauth.expiresAt && Date.now() > creds.claudeAiOauth.expiresAt;
          results['claude-code'] = {
            authenticated: !isExpired,
            details: isExpired ? 'Token expired' : `Authenticated (${creds.claudeAiOauth.subscriptionType || 'active'})`
          };
        } else {
          results['claude-code'] = { authenticated: false, details: 'No access token' };
        }
      } else {
        results['claude-code'] = { authenticated: false, details: 'Empty credentials' };
      }
    } catch {
      results['claude-code'] = { authenticated: false, details: 'Not configured' };
    }

    // Check Azure CLI
    try {
      const { stdout } = await execAsync('az account show --query name -o tsv 2>/dev/null', { timeout: 10000 });
      results['azure-cli'] = { authenticated: stdout.trim().length > 0, details: stdout.trim() || undefined };
    } catch {
      results['azure-cli'] = { authenticated: false, details: 'Not logged in' };
    }

    // Check gcloud
    try {
      const { stdout } = await execAsync('gcloud auth list --filter="status=ACTIVE" --format="value(account)" 2>/dev/null | head -1', { timeout: 10000 });
      results['gcloud'] = { authenticated: stdout.trim().length > 0, details: stdout.trim() || undefined };
    } catch {
      results['gcloud'] = { authenticated: false, details: 'Not logged in' };
    }

    return results;
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
