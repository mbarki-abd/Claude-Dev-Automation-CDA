import { Client, ClientChannel } from 'ssh2';
import { exec } from 'child_process';
import { promisify } from 'util';
import { settingsRepository } from '../database/repositories/SettingsRepository.js';
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
  type: 'ssh' | 'local';
  connection?: Client;
  channel?: ClientChannel;
  createdAt: Date;
}

class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  /**
   * Execute a command - automatically chooses SSH or local based on Hetzner settings
   */
  async executeCommand(command: string, workDir?: string): Promise<CommandResult> {
    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();

      if (hetznerSettings && hetznerSettings.host) {
        logger.info('Executing command via SSH');
        return await this.executeSSHCommand(command, workDir);
      } else {
        logger.info('Executing command locally');
        return await this.executeLocalCommand(command, workDir);
      }
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
   * Execute command via SSH on production server
   */
  private async executeSSHCommand(command: string, workDir?: string): Promise<CommandResult> {
    const hetznerSettings = await settingsRepository.getHetznerSettings();

    if (!hetznerSettings) {
      throw new Error('Hetzner SSH settings not configured');
    }

    return new Promise((resolve) => {
      const conn = new Client();
      let output = '';
      let error = '';

      const timeout = setTimeout(() => {
        conn.end();
        resolve({
          output: output || error,
          exitCode: 1,
          error: 'Command timeout after 30 seconds',
        });
      }, 30000);

      conn.on('ready', () => {
        // Add cd command if workDir specified
        const fullCommand = workDir ? `cd ${workDir} && ${command}` : command;

        conn.exec(fullCommand, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            resolve({
              output: err.message,
              exitCode: 1,
              error: err.message,
            });
            return;
          }

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            error += data.toString();
          });

          stream.on('close', (code: number) => {
            clearTimeout(timeout);
            conn.end();
            resolve({
              output: output || error,
              exitCode: code,
              error: code !== 0 ? error : undefined,
            });
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          output: err.message,
          exitCode: 1,
          error: `SSH error: ${err.message}`,
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
        readyTimeout: 30000,
      });
    });
  }

  /**
   * Execute command locally - works on both Windows and Linux
   */
  private async executeLocalCommand(command: string, workDir?: string): Promise<CommandResult> {
    try {
      // Detect platform and use appropriate shell
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';

      // For Windows, wrap command in PowerShell
      const shellCommand = isWindows ?
        `powershell.exe -NoProfile -Command "${command.replace(/"/g, '\\"')}"` :
        command;

      const options = {
        cwd: workDir || process.cwd(),
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: shell,
        encoding: 'utf8' as BufferEncoding,
      };

      const { stdout, stderr } = await execAsync(shellCommand, options);

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
   * Create an interactive SSH session for streaming output
   */
  async createInteractiveSession(sessionId: string): Promise<TerminalSession> {
    const hetznerSettings = await settingsRepository.getHetznerSettings();

    if (!hetznerSettings || !hetznerSettings.host) {
      // Create local session
      const session: TerminalSession = {
        id: sessionId,
        type: 'local',
        createdAt: new Date(),
      };
      this.sessions.set(sessionId, session);
      return session;
    }

    // Create SSH session
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.shell((err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          const session: TerminalSession = {
            id: sessionId,
            type: 'ssh',
            connection: conn,
            channel: stream,
            createdAt: new Date(),
          };

          this.sessions.set(sessionId, session);
          resolve(session);
        });
      });

      conn.on('error', (err) => {
        reject(err);
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
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.channel) {
        session.channel.end();
      }
      if (session.connection) {
        session.connection.end();
      }
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
