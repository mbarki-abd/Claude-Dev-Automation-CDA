import { exec } from 'child_process';
import { promisify } from 'util';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('terminal-service');
const execAsync = promisify(exec);

export interface CommandResult {
  output: string;
  exitCode: number;
  error?: string;
}

export interface TerminalSession {
  id: string;
  type: 'local';
  createdAt: Date;
}

class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  /**
   * Execute a command locally on the native server
   */
  async executeCommand(command: string, workDir?: string): Promise<CommandResult> {
    try {
      logger.info({ command, workDir }, 'Executing command locally');
      return await this.executeLocalCommand(command, workDir);
    } catch (error) {
      logger.error({ error }, 'Failed to execute command');
      return {
        output: (error as Error).message,
        exitCode: 1,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Execute command locally on native Linux server
   */
  private async executeLocalCommand(command: string, workDir?: string): Promise<CommandResult> {
    try {
      const options = {
        cwd: workDir || process.cwd(),
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash',
        encoding: 'utf8' as BufferEncoding,
        env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin' },
      };

      const { stdout, stderr } = await execAsync(command, options);

      return {
        output: stdout || stderr,
        exitCode: 0,
        error: stderr ? stderr : undefined,
      };
    } catch (error: any) {
      return {
        output: error.stdout || error.stderr || error.message,
        exitCode: error.code || 1,
        error: error.stderr || error.message,
      };
    }
  }

  /**
   * Create a local terminal session
   */
  async createInteractiveSession(sessionId: string): Promise<TerminalSession> {
    const session: TerminalSession = {
      id: sessionId,
      type: 'local',
      createdAt: new Date(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, 'Terminal session closed');
    }
  }

  /**
   * Get active session
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active sessions
   */
  getActiveSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }
}

export const terminalService = new TerminalService();
