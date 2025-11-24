import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ApiResponse } from '@cda/shared';
import { createChildLogger } from '../utils/logger.js';
import { addSystemLog } from './system-logs.js';
import { settingsRepository } from '../database/repositories/SettingsRepository.js';

const logger = createChildLogger('terminal');

// Workspace configuration
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || 'claude';

// SSH execution helper for remote commands
async function executeSSHCommand(command: string, workDir?: string): Promise<{ output: string; exitCode: number }> {
  const settings = await settingsRepository.getHetznerSettings();

  if (!settings) {
    // Fall back to local execution if SSH not configured
    try {
      const output = execSync(command, {
        cwd: workDir || WORKSPACE_DIR,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { output, exitCode: 0 };
    } catch (error: any) {
      return { output: error.stdout || error.message, exitCode: error.status || 1 };
    }
  }

  // Use SSH for remote execution
  const { Client } = await import('ssh2');

  return new Promise((resolve) => {
    const conn = new Client();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        resolve({ output: 'Command timeout', exitCode: 124 });
      }
    }, 60000);

    conn.on('ready', () => {
      const fullCommand = workDir ? `cd ${workDir} && ${command}` : command;
      conn.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          resolved = true;
          conn.end();
          resolve({ output: err.message, exitCode: 1 });
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on('close', (code: number) => {
          clearTimeout(timeout);
          resolved = true;
          conn.end();
          const output = stdout + (stderr ? `\n${stderr}` : '');
          resolve({ output, exitCode: code || 0 });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve({ output: `SSH Error: ${err.message}`, exitCode: 1 });
      }
    });

    conn.connect({
      host: settings.host,
      port: settings.port || 22,
      username: settings.username,
      password: settings.authMethod === 'password' ? settings.password : undefined,
      privateKey: settings.authMethod === 'ssh-key' && settings.sshKeyPath
        ? require('fs').readFileSync(settings.sshKeyPath)
        : undefined,
      readyTimeout: 10000
    });
  });
}

// Execute command schema
const executeSchema = z.object({
  command: z.string().min(1).max(1000),
  workDir: z.string().optional(),
});

// List files schema
const listFilesSchema = z.object({
  path: z.string().min(1).max(500),
});

// Claude Code schema
const claudeCodeSchema = z.object({
  prompt: z.string().min(1).max(10000),
  workDir: z.string().optional(),
});

export const terminalRoutes: FastifyPluginAsync = async (fastify) => {
  // Get workspace info
  fastify.get('/api/terminal/workspace', async () => {
    const workspaceExists = fs.existsSync(WORKSPACE_DIR);
    let files: string[] = [];

    if (workspaceExists) {
      try {
        files = fs.readdirSync(WORKSPACE_DIR);
      } catch (error) {
        logger.error({ error }, 'Failed to read workspace directory');
      }
    }

    addSystemLog('info', 'system', 'terminal', 'Workspace info requested', {
      metadata: { workspaceExists, filesCount: files.length },
    });

    const response: ApiResponse<{
      workspaceDir: string;
      exists: boolean;
      files: string[];
    }> = {
      success: true,
      data: {
        workspaceDir: WORKSPACE_DIR,
        exists: workspaceExists,
        files,
      },
    };

    return response;
  });

  // Execute command in container
  fastify.post<{
    Body: z.infer<typeof executeSchema>;
  }>('/api/terminal/execute', async (request, reply) => {
    const body = executeSchema.parse(request.body);
    const workDir = body.workDir || WORKSPACE_DIR;

    logger.info({ command: body.command, workDir }, 'Executing command');
    addSystemLog('info', 'execution', 'terminal', `Executing: ${body.command}`, {
      metadata: { workDir },
    });

    try {
      // Safety check - block dangerous commands
      const dangerousPatterns = [
        /rm\s+-rf\s+\//,
        /mkfs/,
        /dd\s+if=/,
        /:(){ :|:& };:/,
        /chmod\s+-R\s+777\s+\//,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(body.command)) {
          addSystemLog('error', 'system', 'terminal', `Blocked dangerous command: ${body.command}`);
          reply.code(403);
          return {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'This command is not allowed for safety reasons',
            },
          };
        }
      }

      // Use SSH for remote execution if configured
      const result = await executeSSHCommand(body.command, workDir);

      addSystemLog(
        result.exitCode === 0 ? 'success' : 'error',
        'execution',
        'terminal',
        `Command ${result.exitCode === 0 ? 'completed' : 'failed'}: ${body.command}`,
        {
          metadata: { exitCode: result.exitCode, outputLength: result.output.length },
        }
      );

      const response: ApiResponse<{ output: string; exitCode: number }> = {
        success: true,
        data: result,
      };

      return response;
    } catch (error: any) {
      const output = error.stdout || error.message;
      const exitCode = error.status || 1;

      addSystemLog('error', 'execution', 'terminal', `Command failed: ${body.command}`, {
        details: output,
        metadata: { exitCode },
      });

      const response: ApiResponse<{ output: string; exitCode: number }> = {
        success: true,
        data: { output, exitCode },
      };

      return response;
    }
  });

  // List files in directory
  fastify.post<{
    Body: z.infer<typeof listFilesSchema>;
  }>('/api/terminal/files', async (request, reply) => {
    const body = listFilesSchema.parse(request.body);
    const targetPath = path.resolve(WORKSPACE_DIR, body.path);

    // Security check - ensure path is within workspace
    if (!targetPath.startsWith(WORKSPACE_DIR)) {
      reply.code(403);
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied - path outside workspace',
        },
      };
    }

    try {
      const stats = fs.statSync(targetPath);

      if (!stats.isDirectory()) {
        reply.code(400);
        return {
          success: false,
          error: {
            code: 'NOT_DIRECTORY',
            message: 'Path is not a directory',
          },
        };
      }

      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
        size: entry.isFile() ? fs.statSync(path.join(targetPath, entry.name)).size : undefined,
      }));

      addSystemLog('info', 'system', 'terminal', `Listed files: ${body.path}`, {
        metadata: { count: files.length },
      });

      const response: ApiResponse<{
        files: Array<{ name: string; type: 'file' | 'directory'; size?: number }>;
      }> = {
        success: true,
        data: { files },
      };

      return response;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        reply.code(404);
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Directory not found',
          },
        };
      }

      throw error;
    }
  });

  // Execute Claude Code command
  fastify.post<{
    Body: z.infer<typeof claudeCodeSchema>;
  }>('/api/terminal/claude-code', async (request) => {
    const body = claudeCodeSchema.parse(request.body);
    const workDir = body.workDir || WORKSPACE_DIR;

    logger.info({ prompt: body.prompt.slice(0, 100), workDir }, 'Executing Claude Code');
    addSystemLog('info', 'execution', 'terminal', `Claude Code: ${body.prompt.slice(0, 50)}...`, {
      metadata: { workDir },
    });

    try {
      // Check if we should use SSH (remote execution)
      const settings = await settingsRepository.getHetznerSettings();

      if (settings) {
        // Execute Claude Code via SSH on remote server
        const claudeCommand = `cd ${workDir} && claude --print --dangerously-skip-permissions "${body.prompt.replace(/"/g, '\\"')}"`;
        const result = await executeSSHCommand(claudeCommand);

        addSystemLog(
          result.exitCode === 0 ? 'success' : 'error',
          'execution',
          'claude-code',
          `Claude Code completed (remote)`,
          {
            details: result.output.slice(0, 500),
            metadata: { exitCode: result.exitCode, outputLength: result.output.length },
          }
        );

        return {
          success: true,
          data: result,
        };
      }

      // Local execution
      const args = [
        '--print',
        '--dangerously-skip-permissions',
        body.prompt,
      ];

      return new Promise((resolve) => {
        const proc = spawn(CLAUDE_CODE_PATH, args, {
          cwd: workDir,
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          const exitCode = code || 0;
          const output = stdout + (stderr ? `\n\nStderr:\n${stderr}` : '');

          addSystemLog(
            exitCode === 0 ? 'success' : 'error',
            'execution',
            'claude-code',
            `Claude Code completed`,
            {
              details: output.slice(0, 500),
              metadata: { exitCode, outputLength: output.length },
            }
          );

          const response: ApiResponse<{ output: string; exitCode: number }> = {
            success: true,
            data: { output, exitCode },
          };

          resolve(response);
        });

        proc.on('error', (error) => {
          addSystemLog('error', 'execution', 'claude-code', 'Claude Code failed to start', {
            details: error.message,
          });

          const response: ApiResponse<{ output: string; exitCode: number }> = {
            success: true,
            data: { output: error.message, exitCode: 1 },
          };

          resolve(response);
        });

        // Timeout after 5 minutes
        setTimeout(() => {
          proc.kill();
          addSystemLog('warning', 'execution', 'claude-code', 'Claude Code timed out');

          const response: ApiResponse<{ output: string; exitCode: number }> = {
            success: true,
            data: {
              output: stdout + '\n\n[Process timed out after 5 minutes]',
              exitCode: 124,
            },
          };

          resolve(response);
        }, 300000);
      });
    } catch (error: any) {
      addSystemLog('error', 'execution', 'claude-code', 'Claude Code error', {
        details: error.message,
      });

      const response: ApiResponse<{ output: string; exitCode: number }> = {
        success: true,
        data: { output: error.message, exitCode: 1 },
      };

      return response;
    }
  });

  // Get container folder structure
  fastify.get('/api/terminal/tree', async () => {
    const getTree = (dir: string, depth = 0, maxDepth = 3): any => {
      if (depth >= maxDepth || !fs.existsSync(dir)) {
        return null;
      }

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const result: any = {};

        for (const entry of entries) {
          // Skip hidden files and node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }

          if (entry.isDirectory()) {
            const children = getTree(path.join(dir, entry.name), depth + 1, maxDepth);
            result[entry.name + '/'] = children || '...';
          } else {
            result[entry.name] = 'file';
          }
        }

        return result;
      } catch (error) {
        return null;
      }
    };

    const tree = getTree(WORKSPACE_DIR);

    addSystemLog('info', 'system', 'terminal', 'Folder tree requested');

    const response: ApiResponse<{
      root: string;
      tree: any;
    }> = {
      success: true,
      data: {
        root: WORKSPACE_DIR,
        tree: tree || {},
      },
    };

    return response;
  });
};
