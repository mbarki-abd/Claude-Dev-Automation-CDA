import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('claude-code');

export interface ClaudeCodeConfig {
  authMethod: 'claude-ai' | 'api-key';
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
}

export class ClaudeCodeService extends EventEmitter {
  private config: ClaudeCodeConfig;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    super();
    this.config = this.loadConfig();
  }

  private loadConfig(): ClaudeCodeConfig {
    return {
      authMethod: (process.env.CLAUDE_CODE_AUTH as 'claude-ai' | 'api-key') || 'claude-ai',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_CODE_MODEL || 'claude-sonnet-4-20250514',
      maxTokens: parseInt(process.env.CLAUDE_CODE_MAX_TOKENS || '8192', 10),
      timeout: parseInt(process.env.CLAUDE_CODE_TIMEOUT || '300000', 10),
    };
  }

  /**
   * Check if Claude Code CLI is available and authenticated
   */
  async checkConnection(): Promise<{ connected: boolean; method: string; error?: string }> {
    return new Promise((resolve) => {
      const claudeProcess = spawn('claude', ['--version'], {
        shell: true,
        env: this.getEnvironment(),
      });

      let output = '';
      let errorOutput = '';

      claudeProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      claudeProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      claudeProcess.on('close', (code) => {
        if (code === 0) {
          resolve({
            connected: true,
            method: this.config.authMethod,
          });
        } else {
          resolve({
            connected: false,
            method: this.config.authMethod,
            error: errorOutput || 'Claude Code CLI not found or not authenticated',
          });
        }
      });

      claudeProcess.on('error', (err) => {
        resolve({
          connected: false,
          method: this.config.authMethod,
          error: `Failed to spawn Claude Code: ${err.message}`,
        });
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        claudeProcess.kill();
        resolve({
          connected: false,
          method: this.config.authMethod,
          error: 'Connection check timed out',
        });
      }, 10000);
    });
  }

  /**
   * Execute a prompt using Claude Code Terminal
   */
  async execute(
    executionId: string,
    prompt: string,
    workingDirectory?: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      logger.info({ executionId, prompt: prompt.substring(0, 100) }, 'Starting Claude Code execution');

      // Build command arguments
      // Note: --dangerously-skip-permissions requires running as non-root user
      // PM2 should be configured to run as the 'cda' user
      const args = [
        '--print',  // Non-interactive mode, print response
        '--dangerously-skip-permissions',  // Allow all tools without prompting (for automation)
        '--model', this.config.model || 'claude-sonnet-4-20250514',
      ];

      // Spawn Claude Code process
      const claudeProcess = spawn('claude', args, {
        shell: true,
        cwd: workingDirectory || process.cwd(),
        env: this.getEnvironment(),
      });

      this.activeProcesses.set(executionId, claudeProcess);

      let output = '';
      let errorOutput = '';

      // Send prompt to stdin
      claudeProcess.stdin?.write(prompt);
      claudeProcess.stdin?.end();

      // Stream stdout
      claudeProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        this.emit('output', { executionId, data: chunk, stream: 'stdout' });
      });

      // Stream stderr
      claudeProcess.stderr?.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        this.emit('output', { executionId, data: chunk, stream: 'stderr' });
      });

      // Handle completion
      claudeProcess.on('close', (code) => {
        this.activeProcesses.delete(executionId);
        const duration = Date.now() - startTime;

        logger.info({ executionId, exitCode: code, duration }, 'Claude Code execution completed');

        resolve({
          success: code === 0,
          output,
          error: errorOutput || undefined,
          exitCode: code || 0,
          duration,
        });
      });

      // Handle errors
      claudeProcess.on('error', (err) => {
        this.activeProcesses.delete(executionId);
        const duration = Date.now() - startTime;

        logger.error({ executionId, error: err }, 'Claude Code execution failed');

        resolve({
          success: false,
          output,
          error: err.message,
          exitCode: 1,
          duration,
        });
      });

      // Timeout handling
      setTimeout(() => {
        if (this.activeProcesses.has(executionId)) {
          claudeProcess.kill('SIGTERM');
          const duration = Date.now() - startTime;

          logger.warn({ executionId, timeout: this.config.timeout }, 'Claude Code execution timed out');

          resolve({
            success: false,
            output,
            error: `Execution timed out after ${this.config.timeout}ms`,
            exitCode: 124,
            duration,
          });
        }
      }, this.config.timeout);
    });
  }

  /**
   * Execute a task with full context
   */
  async executeTask(
    executionId: string,
    task: {
      title: string;
      description?: string;
      type: string;
      executionPlan?: string[];
      requiredTools?: string[];
    },
    workingDirectory?: string
  ): Promise<ExecutionResult> {
    // Build comprehensive prompt for Claude Code
    const prompt = this.buildTaskPrompt(task);
    return this.execute(executionId, prompt, workingDirectory);
  }

  /**
   * Cancel an active execution
   */
  cancel(executionId: string): boolean {
    const process = this.activeProcesses.get(executionId);
    if (process) {
      process.kill('SIGTERM');
      this.activeProcesses.delete(executionId);
      logger.info({ executionId }, 'Execution cancelled');
      return true;
    }
    return false;
  }

  /**
   * Get active execution count
   */
  getActiveCount(): number {
    return this.activeProcesses.size;
  }

  private buildTaskPrompt(task: {
    title: string;
    description?: string;
    type: string;
    executionPlan?: string[];
    requiredTools?: string[];
  }): string {
    let prompt = `# Task: ${task.title}\n\n`;

    if (task.description) {
      prompt += `## Description\n${task.description}\n\n`;
    }

    prompt += `## Task Type\n${task.type}\n\n`;

    if (task.executionPlan && task.executionPlan.length > 0) {
      prompt += `## Execution Plan\n`;
      task.executionPlan.forEach((step, index) => {
        prompt += `${index + 1}. ${step}\n`;
      });
      prompt += '\n';
    }

    if (task.requiredTools && task.requiredTools.length > 0) {
      prompt += `## Available Tools\n`;
      prompt += task.requiredTools.join(', ') + '\n\n';
    }

    prompt += `## Instructions\n`;
    prompt += `Please complete this task following the execution plan above. `;
    prompt += `Use the available tools as needed. `;
    prompt += `Provide clear output for each step completed.\n`;

    return prompt;
  }

  private getEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // Clear SUDO_* environment variables to avoid root detection issues
    delete env.SUDO_USER;
    delete env.SUDO_UID;
    delete env.SUDO_GID;
    delete env.SUDO_COMMAND;

    if (this.config.authMethod === 'api-key' && this.config.apiKey) {
      // Set API key if using api-key auth method
      env.ANTHROPIC_API_KEY = this.config.apiKey;
    } else {
      // Using OAuth auth - remove any API key to prevent Claude CLI from using it
      delete env.ANTHROPIC_API_KEY;
    }

    return env;
  }
}

// Singleton instance
export const claudeCodeService = new ClaudeCodeService();
