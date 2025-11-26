import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ApiResponse } from '@cda/shared';
import { createChildLogger } from '../utils/logger.js';
import { addSystemLog } from './system-logs.js';
import { terminalService } from '../services/TerminalService.js';

const logger = createChildLogger('terminal');

// Workspace configuration
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/claude-workspace';

// Execute command schema
const executeSchema = z.object({
  command: z.string().min(1).max(1000),
  workDir: z.string().optional(),
});

// Streaming command schema
const streamingExecuteSchema = z.object({
  command: z.string().min(1).max(1000),
  args: z.array(z.string()).optional(),
  workDir: z.string().optional(),
  sessionId: z.string().optional(),
});

// List files schema
const listFilesSchema = z.object({
  path: z.string().min(1).max(500),
});

// Claude Code schema
const claudeCodeSchema = z.object({
  prompt: z.string().min(1).max(10000),
  workDir: z.string().optional(),
  sessionId: z.string().optional(),
});

// Kill session schema
const killSessionSchema = z.object({
  sessionId: z.string().min(1),
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

  // Execute command (non-streaming, waits for completion)
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

      // Execute command using terminal service (local)
      const result = await terminalService.executeCommand(body.command, workDir);

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

  // Execute command with streaming (returns immediately, output via WebSocket)
  fastify.post<{
    Body: z.infer<typeof streamingExecuteSchema>;
  }>('/api/terminal/stream', async (request) => {
    const body = streamingExecuteSchema.parse(request.body);
    const workDir = body.workDir || WORKSPACE_DIR;
    const sessionId = body.sessionId || uuidv4();

    logger.info({ sessionId, command: body.command, workDir }, 'Starting streaming command');
    addSystemLog('info', 'execution', 'terminal', `Streaming: ${body.command}`, {
      metadata: { sessionId, workDir },
    });

    // Start the streaming command
    terminalService.executeCommandStreaming(
      sessionId,
      body.command,
      body.args || [],
      workDir
    );

    const response: ApiResponse<{ sessionId: string; message: string }> = {
      success: true,
      data: {
        sessionId,
        message: 'Command started. Connect to WebSocket and subscribe to terminal:' + sessionId + ' for output.',
      },
    };

    return response;
  });

  // Execute Claude Code with streaming (returns immediately, output via WebSocket)
  fastify.post<{
    Body: z.infer<typeof claudeCodeSchema>;
  }>('/api/terminal/claude-code', async (request) => {
    const body = claudeCodeSchema.parse(request.body);
    const workDir = body.workDir || WORKSPACE_DIR;
    const sessionId = body.sessionId || uuidv4();

    logger.info({ sessionId, prompt: body.prompt.slice(0, 100), workDir }, 'Starting Claude Code streaming');
    addSystemLog('info', 'execution', 'claude-code', `Claude Code: ${body.prompt.slice(0, 50)}...`, {
      metadata: { sessionId, workDir },
    });

    // Start Claude Code with streaming
    terminalService.executeClaudeCodeStreaming(sessionId, body.prompt, workDir);

    const response: ApiResponse<{ sessionId: string; message: string }> = {
      success: true,
      data: {
        sessionId,
        message: 'Claude Code started. Connect to WebSocket and subscribe to terminal:' + sessionId + ' for output.',
      },
    };

    return response;
  });

  // Start interactive terminal session
  fastify.post<{
    Body: { workDir?: string; sessionId?: string };
  }>('/api/terminal/interactive', async (request) => {
    const workDir = request.body?.workDir || WORKSPACE_DIR;
    const sessionId = request.body?.sessionId || uuidv4();

    logger.info({ sessionId, workDir }, 'Starting interactive terminal');
    addSystemLog('info', 'execution', 'terminal', 'Interactive terminal started', {
      metadata: { sessionId, workDir },
    });

    // Create interactive session
    terminalService.createInteractiveSession(sessionId, workDir);

    const response: ApiResponse<{ sessionId: string; message: string }> = {
      success: true,
      data: {
        sessionId,
        message: 'Interactive terminal started. Connect to WebSocket and subscribe to terminal:' + sessionId,
      },
    };

    return response;
  });

  // Kill a terminal session
  fastify.post<{
    Body: z.infer<typeof killSessionSchema>;
  }>('/api/terminal/kill', async (request) => {
    const body = killSessionSchema.parse(request.body);

    logger.info({ sessionId: body.sessionId }, 'Killing terminal session');

    const killed = terminalService.killSession(body.sessionId);

    const response: ApiResponse<{ killed: boolean }> = {
      success: true,
      data: { killed },
    };

    return response;
  });

  // Get active terminal sessions
  fastify.get('/api/terminal/sessions', async () => {
    const sessions = terminalService.getActiveSessions();

    const response: ApiResponse<{
      sessions: Array<{
        id: string;
        type: string;
        createdAt: Date;
        command?: string;
        workDir?: string;
      }>;
    }> = {
      success: true,
      data: {
        sessions: sessions.map((s) => ({
          id: s.id,
          type: s.type,
          createdAt: s.createdAt,
          command: s.command,
          workDir: s.workDir,
        })),
      },
    };

    return response;
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
