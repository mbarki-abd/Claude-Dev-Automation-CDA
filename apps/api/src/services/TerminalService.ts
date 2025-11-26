import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('terminal-service');
const execAsync = promisify(exec);

// Try to import node-pty if available
let pty: any = null;
try {
  pty = await import('node-pty');
} catch (e) {
  logger.info('node-pty not available, using basic shell');
}

export interface CommandResult {
  output: string;
  exitCode: number;
  error?: string;
}

export interface TerminalSession {
  id: string;
  type: 'local';
  process?: ChildProcess | any;
  createdAt: Date;
  command?: string;
  workDir?: string;
}

export interface StreamingOptions {
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  onExit?: (code: number) => void;
}

class TerminalService extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();

  constructor() {
    super();
  }

  /**
   * Execute a command locally on the native server (non-streaming)
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
   * Execute command with real-time streaming output
   */
  executeCommandStreaming(
    sessionId: string,
    command: string,
    args: string[] = [],
    workDir?: string,
    options?: StreamingOptions
  ): TerminalSession {
    const cwd = workDir || process.cwd();

    logger.info({ sessionId, command, args, cwd }, 'Starting streaming command');

    const proc = spawn(command, args, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin',
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    });

    const session: TerminalSession = {
      id: sessionId,
      type: 'local',
      process: proc,
      createdAt: new Date(),
      command: `${command} ${args.join(' ')}`,
      workDir: cwd,
    };

    this.sessions.set(sessionId, session);

    // Stream stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      this.emit('output', { sessionId, data: output, type: 'stdout' });
      options?.onOutput?.(output);
    });

    // Stream stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      this.emit('output', { sessionId, data: output, type: 'stderr' });
      options?.onError?.(output);
    });

    // Handle process exit
    proc.on('close', (code: number | null) => {
      const exitCode = code ?? 0;
      logger.info({ sessionId, exitCode }, 'Streaming command completed');
      this.emit('exit', { sessionId, exitCode });
      options?.onExit?.(exitCode);
      this.sessions.delete(sessionId);
    });

    // Handle errors
    proc.on('error', (error: Error) => {
      logger.error({ sessionId, error: error.message }, 'Streaming command error');
      this.emit('error', { sessionId, error: error.message });
      options?.onError?.(error.message);
    });

    return session;
  }

  /**
   * Execute Claude Code with streaming output
   */
  executeClaudeCodeStreaming(
    sessionId: string,
    prompt: string,
    workDir?: string,
    options?: StreamingOptions
  ): TerminalSession {
    const claudePath = process.env.CLAUDE_CODE_PATH || 'claude';
    const args = ['--print', '--dangerously-skip-permissions', prompt];

    return this.executeCommandStreaming(sessionId, claudePath, args, workDir, options);
  }

  /**
   * Execute command locally on native Linux server (non-streaming)
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
   * Create an interactive terminal session with PTY
   */
  createInteractiveSession(sessionId: string, workDir?: string): TerminalSession {
    const cwd = workDir || process.cwd();
    let proc: ChildProcess | any;

    // Try to use node-pty for full PTY support, fallback to basic shell
    if (pty) {
      try {
        proc = pty.spawn('/bin/bash', [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          cwd,
          env: {
            ...process.env,
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin',
            TERM: 'xterm-256color',
          },
        });

        // PTY data handler
        proc.onData((data: string) => {
          this.emit('output', { sessionId, data, type: 'stdout' });
        });

        proc.onExit(({ exitCode }: { exitCode: number }) => {
          logger.info({ sessionId, exitCode }, 'Interactive session exited');
          this.emit('exit', { sessionId, exitCode });
          this.sessions.delete(sessionId);
        });
      } catch (e) {
        logger.warn({ error: e }, 'Failed to create PTY, falling back to basic shell');
        proc = this.createBasicShell(sessionId, cwd);
      }
    } else {
      // Fallback to basic spawn
      proc = this.createBasicShell(sessionId, cwd);
    }

    const session: TerminalSession = {
      id: sessionId,
      type: 'local',
      process: proc,
      createdAt: new Date(),
      workDir: cwd,
    };

    this.sessions.set(sessionId, session);
    logger.info({ sessionId, cwd }, 'Interactive session created');

    return session;
  }

  /**
   * Create a basic shell process (fallback when node-pty is not available)
   */
  private createBasicShell(sessionId: string, cwd: string): ChildProcess {
    const proc = spawn('/bin/bash', ['-i'], {
      cwd,
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin',
        TERM: 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data: Buffer) => {
      this.emit('output', { sessionId, data: data.toString(), type: 'stdout' });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      this.emit('output', { sessionId, data: data.toString(), type: 'stderr' });
    });

    proc.on('close', (code: number | null) => {
      const exitCode = code ?? 0;
      this.emit('exit', { sessionId, exitCode });
      this.sessions.delete(sessionId);
    });

    proc.on('error', (error: Error) => {
      logger.error({ sessionId, error: error.message }, 'Shell process error');
      this.emit('error', { sessionId, error: error.message });
    });

    return proc;
  }

  /**
   * Send input to an interactive session
   */
  sendInput(sessionId: string, input: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process) {
      return false;
    }

    try {
      const proc = session.process;
      // Check if it's a PTY (has write method directly) or ChildProcess (has stdin.write)
      if (typeof proc.write === 'function') {
        // node-pty IPty
        proc.write(input);
      } else if (proc.stdin && typeof proc.stdin.write === 'function') {
        // ChildProcess
        proc.stdin.write(input);
      } else {
        return false;
      }
      return true;
    } catch (error) {
      logger.error({ sessionId, error }, 'Failed to send input');
      return false;
    }
  }

  /**
   * Resize terminal
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process) {
      return false;
    }

    try {
      const proc = session.process;
      if (typeof proc.resize === 'function') {
        proc.resize(cols, rows);
        return true;
      }
    } catch (error) {
      logger.error({ sessionId, error }, 'Failed to resize terminal');
    }
    return false;
  }

  /**
   * Kill a session
   */
  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      if (session.process) {
        const proc = session.process;
        if (typeof proc.kill === 'function') {
          // Both pty and ChildProcess have kill method
          proc.kill('SIGTERM');
        }
      }
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, 'Session killed');
      return true;
    } catch (error) {
      logger.error({ sessionId, error }, 'Failed to kill session');
      return false;
    }
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    this.killSession(sessionId);
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
