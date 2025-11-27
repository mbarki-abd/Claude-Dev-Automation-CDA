import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger.js';
import * as nodePty from 'node-pty';
import { userRepository } from '../database/repositories/UserRepository.js';

const logger = createChildLogger('terminal-service');
const execAsync = promisify(exec);

// node-pty for full PTY support
const pty = nodePty;

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
  userId?: string;
  unixUsername?: string;
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
   * Execute Claude Code with streaming output in interactive PTY
   */
  executeClaudeCodeStreaming(
    sessionId: string,
    prompt: string,
    workDir?: string,
    options?: StreamingOptions
  ): TerminalSession {
    const claudePath = process.env.CLAUDE_CODE_PATH || 'claude';
    const cwd = workDir || '/root';

    logger.info({ sessionId, prompt: prompt.slice(0, 100), cwd }, 'Starting Claude Code in PTY');

    // Use PTY for full interactive Claude Code experience
    if (pty) {
      try {
        const proc = pty.spawn(claudePath, ['--dangerously-skip-permissions'], {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd,
          env: {
            ...process.env,
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin',
            TERM: 'xterm-256color',
            FORCE_COLOR: '1',
            NO_COLOR: '',
          },
        });

        const session: TerminalSession = {
          id: sessionId,
          type: 'local',
          process: proc,
          createdAt: new Date(),
          command: `claude ${prompt.slice(0, 50)}...`,
          workDir: cwd,
        };

        this.sessions.set(sessionId, session);

        // PTY data handler - stream all output
        proc.onData((data: string) => {
          this.emit('output', { sessionId, data, type: 'stdout' });
          options?.onOutput?.(data);
        });

        proc.onExit(({ exitCode }: { exitCode: number }) => {
          logger.info({ sessionId, exitCode }, 'Claude Code session exited');
          this.emit('exit', { sessionId, exitCode });
          options?.onExit?.(exitCode);
          this.sessions.delete(sessionId);
        });

        // Send the initial prompt after a short delay to let Claude initialize
        setTimeout(() => {
          if (prompt && prompt.trim()) {
            proc.write(prompt + '\n');
          }
        }, 500);

        return session;
      } catch (e) {
        logger.error({ error: e }, 'Failed to create Claude Code PTY session');
        // Fallback to non-PTY streaming
        const args = ['--print', '--dangerously-skip-permissions', prompt];
        return this.executeCommandStreaming(sessionId, claudePath, args, workDir, options);
      }
    } else {
      // Fallback without PTY
      const args = ['--print', '--dangerously-skip-permissions', prompt];
      return this.executeCommandStreaming(sessionId, claudePath, args, workDir, options);
    }
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
    const cwd = workDir || '/root';
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
   * Create an interactive terminal session running as a specific user
   */
  async createUserInteractiveSession(sessionId: string, userId: string, workDir?: string): Promise<TerminalSession | null> {
    const user = await userRepository.findById(userId);

    if (!user || !user.unixUsername) {
      logger.warn({ userId }, 'User has no Unix account, cannot create user session');
      return null;
    }

    const cwd = workDir || user.homeDirectory || `/home/${user.unixUsername}`;
    const unixUsername = user.unixUsername;
    let proc: ChildProcess | any;

    // Use sudo to run shell as the user with their environment
    if (pty) {
      try {
        proc = pty.spawn('sudo', ['-u', unixUsername, '-H', '-i'], {
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          cwd,
          env: {
            TERM: 'xterm-256color',
          },
        });

        // PTY data handler
        proc.onData((data: string) => {
          this.emit('output', { sessionId, data, type: 'stdout' });
        });

        proc.onExit(({ exitCode }: { exitCode: number }) => {
          logger.info({ sessionId, userId, exitCode }, 'User interactive session exited');
          this.emit('exit', { sessionId, exitCode });
          this.sessions.delete(sessionId);
        });
      } catch (e) {
        logger.warn({ error: e, userId }, 'Failed to create user PTY session');
        return null;
      }
    } else {
      logger.warn('node-pty not available for user session');
      return null;
    }

    const session: TerminalSession = {
      id: sessionId,
      type: 'local',
      process: proc,
      createdAt: new Date(),
      workDir: cwd,
      userId,
      unixUsername,
    };

    this.sessions.set(sessionId, session);
    logger.info({ sessionId, userId, unixUsername, cwd }, 'User interactive session created');

    return session;
  }

  /**
   * Execute a command as a specific user (non-streaming)
   */
  async executeUserCommand(
    userId: string,
    command: string,
    workDir?: string
  ): Promise<CommandResult> {
    const user = await userRepository.findById(userId);

    if (!user || !user.unixUsername) {
      return {
        output: 'User has no Unix account',
        exitCode: 1,
        error: 'User has no Unix account',
      };
    }

    const cwd = workDir || user.homeDirectory || `/home/${user.unixUsername}`;
    const unixUsername = user.unixUsername;

    try {
      // Use sudo to run command as the user with their full environment
      const fullCommand = `sudo -u ${unixUsername} -H bash -c 'source ~/.bashrc 2>/dev/null; cd "${cwd}" && ${command}'`;

      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });

      logger.debug({ userId, command, cwd }, 'User command executed');

      return {
        output: stdout || stderr,
        exitCode: 0,
        error: stderr ? stderr : undefined,
      };
    } catch (error: any) {
      logger.error({ error, userId, command }, 'User command failed');
      return {
        output: error.stdout || error.stderr || error.message,
        exitCode: error.code || 1,
        error: error.stderr || error.message,
      };
    }
  }

  /**
   * Execute Claude Code as a specific user with streaming
   */
  async executeUserClaudeCodeStreaming(
    sessionId: string,
    userId: string,
    prompt: string,
    workDir?: string,
    options?: StreamingOptions
  ): Promise<TerminalSession | null> {
    const user = await userRepository.findById(userId);

    if (!user || !user.unixUsername) {
      logger.warn({ userId }, 'User has no Unix account for Claude Code');
      options?.onError?.('User has no Unix account');
      return null;
    }

    const cwd = workDir || user.homeDirectory || `/home/${user.unixUsername}`;
    const unixUsername = user.unixUsername;
    const claudePath = process.env.CLAUDE_CODE_PATH || 'claude';

    logger.info({ sessionId, userId, unixUsername, prompt: prompt.slice(0, 100), cwd }, 'Starting Claude Code as user');

    if (pty) {
      try {
        // Run Claude Code as the user with their full environment
        // Using bash -l -c to load user's profile and bashrc which sets CLAUDE_CONFIG_DIR
        const homeDir = user.homeDirectory || `/home/${unixUsername}`;
        const proc = pty.spawn('sudo', [
          '-u', unixUsername,
          '-H',
          'bash', '-l', '-c',
          `export HOME="${homeDir}" && export CLAUDE_CONFIG_DIR="${homeDir}/.config/claude" && cd "${cwd}" && ${claudePath} --dangerously-skip-permissions`
        ], {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd,
          env: {
            TERM: 'xterm-256color',
            HOME: homeDir,
            CLAUDE_CONFIG_DIR: `${homeDir}/.config/claude`,
          },
        });

        const session: TerminalSession = {
          id: sessionId,
          type: 'local',
          process: proc,
          createdAt: new Date(),
          command: `claude ${prompt.slice(0, 50)}...`,
          workDir: cwd,
          userId,
          unixUsername,
        };

        this.sessions.set(sessionId, session);

        // PTY data handler
        proc.onData((data: string) => {
          this.emit('output', { sessionId, data, type: 'stdout' });
          options?.onOutput?.(data);
        });

        proc.onExit(({ exitCode }: { exitCode: number }) => {
          logger.info({ sessionId, userId, exitCode }, 'User Claude Code session exited');
          this.emit('exit', { sessionId, exitCode });
          options?.onExit?.(exitCode);
          this.sessions.delete(sessionId);
        });

        // Send the initial prompt after a short delay
        setTimeout(() => {
          if (prompt && prompt.trim()) {
            proc.write(prompt + '\n');
          }
        }, 500);

        return session;
      } catch (e) {
        logger.error({ error: e, userId }, 'Failed to create user Claude Code PTY session');
        options?.onError?.('Failed to create Claude Code session');
        return null;
      }
    } else {
      logger.warn('node-pty not available for user Claude Code session');
      options?.onError?.('PTY not available');
      return null;
    }
  }

  /**
   * Create a basic shell process (fallback when node-pty is not available)
   */
  private createBasicShell(sessionId: string, cwd: string): ChildProcess {
    // Use bash without -i flag since we don't have a proper TTY
    // Instead, source bashrc manually and set PS1 for prompt
    const proc = spawn('/bin/bash', ['--norc', '--noprofile'], {
      cwd,
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/root/.local/bin',
        TERM: 'xterm-256color',
        PS1: '\\u@\\h:\\w\\$ ',
        HOME: process.env.HOME || '/root',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send initial setup commands
    proc.stdin?.write('export PS1="\\u@\\h:\\w\\$ "\n');
    proc.stdin?.write('cd ' + cwd + '\n');

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
