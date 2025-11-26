import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createChildLogger } from './utils/logger.js';
import { healthRoutes } from './routes/health.js';
import { taskRoutes } from './routes/tasks.js';
import { executionRoutes } from './routes/executions.js';
import { proposalRoutes } from './routes/proposals.js';
import { settingsRoutes } from './routes/settings.js';
import { plannerRoutes } from './routes/planner.js';
import { systemLogsRoutes } from './routes/system-logs.js';
import { terminalRoutes } from './routes/terminal.js';
import { cliAuthRoutes } from './routes/cli-auth.js';
import { WS_EVENTS } from '@cda/shared';
import { cliAuthService } from './services/CLIAuthService.js';
import { terminalService } from './services/TerminalService.js';
import { taskRepository } from './database/repositories/TaskRepository.js';
import { executionRepository } from './database/repositories/ExecutionRepository.js';
import { proposalRepository } from './database/repositories/ProposalRepository.js';
import { claudeCodeService } from './services/ClaudeCodeService.js';
import { plannerSyncService } from './services/PlannerSyncService.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createChildLogger('server');

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // Register CORS
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'Request error');

    // Handle Zod validation errors
    if (error.name === 'ZodError') {
      reply.code(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: error,
        },
      });
      return;
    }

    // Default error response
    reply.code(error.statusCode || 500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(taskRoutes);
  await fastify.register(executionRoutes);
  await fastify.register(proposalRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(plannerRoutes);
  await fastify.register(systemLogsRoutes);
  await fastify.register(terminalRoutes);
  await fastify.register(cliAuthRoutes);

  // Root route
  fastify.get('/', async () => {
    return {
      name: 'Claude Dev Automation API',
      version: '1.0.0',
      docs: '/api/docs',
    };
  });

  return fastify;
}

export function setupWebSocket(server: ReturnType<typeof Fastify>['server']) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    // Join task-specific rooms
    socket.on('subscribe:task', (taskId: string) => {
      socket.join(`task:${taskId}`);
      logger.debug({ socketId: socket.id, taskId }, 'Subscribed to task');
    });

    socket.on('unsubscribe:task', (taskId: string) => {
      socket.leave(`task:${taskId}`);
      logger.debug({ socketId: socket.id, taskId }, 'Unsubscribed from task');
    });

    // Handle task cancellation
    socket.on(WS_EVENTS.TASK_CANCEL, async (data: { taskId: string }) => {
      logger.info({ socketId: socket.id, taskId: data.taskId }, 'Task cancellation requested via WebSocket');
      try {
        const task = await taskRepository.findById(data.taskId);
        if (!task) {
          socket.emit('error', { message: 'Task not found' });
          return;
        }

        if (task.status !== 'executing' && task.status !== 'queued') {
          socket.emit('error', { message: 'Task is not in a cancellable state' });
          return;
        }

        // Find and cancel the running execution
        const latestExecution = await executionRepository.findLatestByTaskId(task.id);
        if (latestExecution && latestExecution.status === 'running') {
          const cancelled = claudeCodeService.cancel(latestExecution.id);
          if (cancelled) {
            await executionRepository.complete(latestExecution.id, {
              status: 'cancelled',
              error: 'Cancelled by user via WebSocket',
              exitCode: 130,
            });
          }
        }

        const updatedTask = await taskRepository.updateStatus(task.id, 'cancelled');

        // Emit task update to all subscribers
        io.to(`task:${data.taskId}`).emit(WS_EVENTS.TASK_UPDATE, updatedTask);
        io.emit(WS_EVENTS.TASK_UPDATE, updatedTask);
      } catch (error) {
        logger.error({ error, taskId: data.taskId }, 'Failed to cancel task');
        socket.emit('error', { message: 'Failed to cancel task' });
      }
    });

    // Handle proposal resolution
    socket.on(WS_EVENTS.PROPOSAL_RESOLVE, async (data: { proposalId: string; optionId: string }) => {
      logger.info(
        { socketId: socket.id, proposalId: data.proposalId, optionId: data.optionId },
        'Proposal resolution received via WebSocket'
      );
      try {
        const proposal = await proposalRepository.findById(data.proposalId);
        if (!proposal) {
          socket.emit('error', { message: 'Proposal not found' });
          return;
        }

        if (proposal.status !== 'pending') {
          socket.emit('error', { message: 'Proposal has already been resolved' });
          return;
        }

        const resolved = await proposalRepository.resolve(data.proposalId, data.optionId);

        // Emit proposal update
        io.emit(WS_EVENTS.PROPOSAL_RESOLVED, resolved);

        // Also emit to task subscribers
        if (proposal.taskId) {
          io.to(`task:${proposal.taskId}`).emit(WS_EVENTS.PROPOSAL_RESOLVED, resolved);
        }
      } catch (error) {
        logger.error({ error, proposalId: data.proposalId }, 'Failed to resolve proposal');
        socket.emit('error', { message: 'Failed to resolve proposal' });
      }
    });

    // Handle terminal resize
    socket.on(WS_EVENTS.TERMINAL_RESIZE, (data: { sessionId: string; cols: number; rows: number }) => {
      logger.debug({ socketId: socket.id, ...data }, 'Terminal resize');
      terminalService.resize(data.sessionId, data.cols, data.rows);
    });

    // Terminal subscriptions
    socket.on('subscribe:terminal', (sessionId: string) => {
      socket.join(`terminal:${sessionId}`);
      logger.debug({ socketId: socket.id, sessionId }, 'Subscribed to terminal session');
    });

    socket.on('unsubscribe:terminal', (sessionId: string) => {
      socket.leave(`terminal:${sessionId}`);
      logger.debug({ socketId: socket.id, sessionId }, 'Unsubscribed from terminal session');
    });

    // Start terminal command with streaming
    socket.on(WS_EVENTS.TERMINAL_START, (data: { command: string; args?: string[]; workDir?: string; sessionId?: string }) => {
      const sessionId = data.sessionId || uuidv4();
      logger.info({ socketId: socket.id, sessionId, command: data.command }, 'Starting terminal command');

      // Join the terminal room
      socket.join(`terminal:${sessionId}`);

      // Emit session started
      socket.emit(WS_EVENTS.TERMINAL_STARTED, { sessionId });

      // Start the streaming command
      terminalService.executeCommandStreaming(
        sessionId,
        data.command,
        data.args || [],
        data.workDir
      );
    });

    // Start Claude Code with streaming
    socket.on('terminal:claude-code', (data: { prompt: string; workDir?: string; sessionId?: string }) => {
      const sessionId = data.sessionId || uuidv4();
      logger.info({ socketId: socket.id, sessionId, prompt: data.prompt.slice(0, 100) }, 'Starting Claude Code');

      // Join the terminal room
      socket.join(`terminal:${sessionId}`);

      // Emit session started
      socket.emit(WS_EVENTS.TERMINAL_STARTED, { sessionId });

      // Start Claude Code streaming
      terminalService.executeClaudeCodeStreaming(sessionId, data.prompt, data.workDir);
    });

    // Start interactive terminal session
    socket.on('terminal:interactive', (data: { workDir?: string; sessionId?: string }) => {
      const sessionId = data.sessionId || uuidv4();
      logger.info({ socketId: socket.id, sessionId }, 'Starting interactive terminal');

      // Join the terminal room
      socket.join(`terminal:${sessionId}`);

      // Emit session started
      socket.emit(WS_EVENTS.TERMINAL_STARTED, { sessionId });

      // Create interactive session
      terminalService.createInteractiveSession(sessionId, data.workDir);
    });

    // Send input to terminal
    socket.on(WS_EVENTS.TERMINAL_INPUT, (data: { sessionId: string; input: string }) => {
      terminalService.sendInput(data.sessionId, data.input);
    });

    // Kill terminal session
    socket.on(WS_EVENTS.TERMINAL_KILL, (data: { sessionId: string }) => {
      logger.info({ socketId: socket.id, sessionId: data.sessionId }, 'Killing terminal session');
      terminalService.killSession(data.sessionId);
    });

    // Handle sync trigger
    socket.on(WS_EVENTS.SYNC_TRIGGER, async () => {
      logger.info({ socketId: socket.id }, 'Manual Planner sync triggered via WebSocket');
      try {
        const result = await plannerSyncService.syncAllTasks();
        socket.emit('sync:complete', {
          success: true,
          synced: result.synced,
          failed: result.failed,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to sync with Planner');
        socket.emit('sync:complete', { success: false, error: 'Sync failed' });
      }
    });

    // CLI Auth subscriptions
    socket.on('subscribe:cli-auth', (sessionId: string) => {
      socket.join(`cli-auth:${sessionId}`);
      logger.debug({ socketId: socket.id, sessionId }, 'Subscribed to CLI auth session');
    });

    socket.on('unsubscribe:cli-auth', (sessionId: string) => {
      socket.leave(`cli-auth:${sessionId}`);
      logger.debug({ socketId: socket.id, sessionId }, 'Unsubscribed from CLI auth session');
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });

  // Forward CLI auth service events to WebSocket clients
  cliAuthService.on('progress', (data) => {
    io.to(`cli-auth:${data.sessionId}`).emit('cli-auth:progress', data);
    io.emit('cli-auth:progress', data); // Also emit globally
    logger.debug({ sessionId: data.sessionId, status: data.status }, 'CLI auth progress emitted');
  });

  cliAuthService.on('output', (data) => {
    io.to(`cli-auth:${data.sessionId}`).emit('cli-auth:output', data);
  });

  // Forward terminal service events to WebSocket clients
  terminalService.on('output', (data: { sessionId: string; data: string; type: string }) => {
    io.to(`terminal:${data.sessionId}`).emit(WS_EVENTS.TERMINAL_OUTPUT, {
      sessionId: data.sessionId,
      data: data.data,
      type: data.type,
    });
  });

  terminalService.on('error', (data: { sessionId: string; error: string }) => {
    io.to(`terminal:${data.sessionId}`).emit(WS_EVENTS.TERMINAL_ERROR, {
      sessionId: data.sessionId,
      error: data.error,
    });
  });

  terminalService.on('exit', (data: { sessionId: string; exitCode: number }) => {
    io.to(`terminal:${data.sessionId}`).emit(WS_EVENTS.TERMINAL_EXIT, {
      sessionId: data.sessionId,
      exitCode: data.exitCode,
    });
  });

  return io;
}

// Helper to emit events to all clients watching a task
export function emitTaskEvent(io: Server, taskId: string, event: string, data: unknown) {
  io.to(`task:${taskId}`).emit(event, data);
}

// Helper to emit events to all connected clients
export function emitGlobalEvent(io: Server, event: string, data: unknown) {
  io.emit(event, data);
}
