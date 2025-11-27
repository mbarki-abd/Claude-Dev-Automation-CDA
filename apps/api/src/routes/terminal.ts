import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ApiResponse } from '@cda/shared';
import { createChildLogger } from '../utils/logger.js';
import { addSystemLog } from './system-logs.js';
import { terminalService } from '../services/TerminalService.js';
import { authService, TokenPayload } from '../services/AuthService.js';
import { userRepository } from '../database/repositories/UserRepository.js';

const logger = createChildLogger('terminal');

// Workspace configuration - fallback for admin/root usage
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/claude-workspace';

// Auth middleware
function requireAuth(request: FastifyRequest, reply: FastifyReply): TokenPayload | undefined {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
    });
    return undefined;
  }

  const token = authHeader.substring(7);
  const payload = authService.verifyAccessToken(token);

  if (!payload) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
    return undefined;
  }

  (request as any).user = payload;
  return payload;
}

// Get user's workspace directory
async function getUserWorkspace(userId: string): Promise<string> {
  const user = await userRepository.findById(userId);
  if (user?.homeDirectory) {
    return path.join(user.homeDirectory, 'projects');
  }
  return WORKSPACE_DIR;
}

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
  fastify.get('/api/terminal/workspace', async (request, reply) => {
    // Authenticate user
    const user = requireAuth(request, reply);
    if (!user) return;

    const userWorkspace = await getUserWorkspace(user.userId);
    const workspaceExists = fs.existsSync(userWorkspace);
    let files: string[] = [];

    if (workspaceExists) {
      try {
        files = fs.readdirSync(userWorkspace);
      } catch (error) {
        logger.error({ error, userId: user.userId }, 'Failed to read workspace directory');
      }
    }

    addSystemLog('info', 'system', 'terminal', 'Workspace info requested', {
      metadata: { workspaceExists, filesCount: files.length, userId: user.userId },
    });

    const response: ApiResponse<{
      workspaceDir: string;
      exists: boolean;
      files: string[];
    }> = {
      success: true,
      data: {
        workspaceDir: userWorkspace,
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
    // Authenticate user
    const user = requireAuth(request, reply);
    if (!user) return;

    const body = executeSchema.parse(request.body);
    const userWorkspace = await getUserWorkspace(user.userId);
    const workDir = body.workDir || userWorkspace;

    logger.info({ command: body.command, workDir, userId: user.userId }, 'Executing command');
    addSystemLog('info', 'execution', 'terminal', `Executing: ${body.command}`, {
      metadata: { workDir, userId: user.userId },
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

      // Execute command as user (if they have a Unix account) or as root for admins
      let result;
      const dbUser = await userRepository.findById(user.userId);

      if (dbUser?.unixUsername) {
        // Execute as the user
        result = await terminalService.executeUserCommand(user.userId, body.command, workDir);
      } else if (user.role === 'admin') {
        // Admin without Unix account - use root
        result = await terminalService.executeCommand(body.command, workDir);
      } else {
        return {
          success: false,
          error: {
            code: 'NO_UNIX_ACCOUNT',
            message: 'You need a Unix account to execute commands. Contact an admin to create one.',
          },
        };
      }

      addSystemLog(
        result.exitCode === 0 ? 'success' : 'error',
        'execution',
        'terminal',
        `Command ${result.exitCode === 0 ? 'completed' : 'failed'}: ${body.command}`,
        {
          metadata: { exitCode: result.exitCode, outputLength: result.output.length, userId: user.userId },
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
        metadata: { exitCode, userId: user.userId },
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
  }>('/api/terminal/claude-code', async (request, reply) => {
    // Authenticate user
    const user = requireAuth(request, reply);
    if (!user) return;

    const body = claudeCodeSchema.parse(request.body);
    const userWorkspace = await getUserWorkspace(user.userId);
    const workDir = body.workDir || userWorkspace;
    const sessionId = body.sessionId || uuidv4();

    logger.info({ sessionId, userId: user.userId, prompt: body.prompt.slice(0, 100), workDir }, 'Starting Claude Code streaming');
    addSystemLog('info', 'execution', 'claude-code', `Claude Code: ${body.prompt.slice(0, 50)}...`, {
      metadata: { sessionId, workDir, userId: user.userId },
    });

    // Start Claude Code with streaming - as user if they have Unix account
    const dbUser = await userRepository.findById(user.userId);

    if (dbUser?.unixUsername) {
      // Execute Claude Code as the user
      const session = await terminalService.executeUserClaudeCodeStreaming(sessionId, user.userId, body.prompt, workDir);
      if (!session) {
        return {
          success: false,
          error: {
            code: 'SESSION_FAILED',
            message: 'Failed to create Claude Code session',
          },
        };
      }
    } else if (user.role === 'admin') {
      // Admin without Unix account - use root
      terminalService.executeClaudeCodeStreaming(sessionId, body.prompt, workDir);
    } else {
      return {
        success: false,
        error: {
          code: 'NO_UNIX_ACCOUNT',
          message: 'You need a Unix account to use Claude Code. Contact an admin to create one.',
        },
      };
    }

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
  }>('/api/terminal/interactive', async (request, reply) => {
    // Authenticate user
    const user = requireAuth(request, reply);
    if (!user) return;

    const userWorkspace = await getUserWorkspace(user.userId);
    const workDir = request.body?.workDir || userWorkspace;
    const sessionId = request.body?.sessionId || uuidv4();

    logger.info({ sessionId, userId: user.userId, workDir }, 'Starting interactive terminal');
    addSystemLog('info', 'execution', 'terminal', 'Interactive terminal started', {
      metadata: { sessionId, workDir, userId: user.userId },
    });

    // Create interactive session - as user if they have Unix account
    const dbUser = await userRepository.findById(user.userId);

    if (dbUser?.unixUsername) {
      // Create session running as the user
      const session = await terminalService.createUserInteractiveSession(sessionId, user.userId, workDir);
      if (!session) {
        return {
          success: false,
          error: {
            code: 'SESSION_FAILED',
            message: 'Failed to create interactive session',
          },
        };
      }
    } else if (user.role === 'admin') {
      // Admin without Unix account - use root
      terminalService.createInteractiveSession(sessionId, workDir);
    } else {
      return {
        success: false,
        error: {
          code: 'NO_UNIX_ACCOUNT',
          message: 'You need a Unix account to use the terminal. Contact an admin to create one.',
        },
      };
    }

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
