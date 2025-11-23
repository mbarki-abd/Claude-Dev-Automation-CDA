import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createChildLogger } from './utils/logger.js';
import { healthRoutes } from './routes/health.js';
import { taskRoutes } from './routes/tasks.js';
import { executionRoutes } from './routes/executions.js';
import { proposalRoutes } from './routes/proposals.js';
import { WS_EVENTS } from '@cda/shared';

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
      logger.info({ socketId: socket.id, taskId: data.taskId }, 'Task cancellation requested');
      // TODO: Implement cancellation logic
    });

    // Handle proposal resolution
    socket.on(WS_EVENTS.PROPOSAL_RESOLVE, async (data: { proposalId: string; option: string }) => {
      logger.info(
        { socketId: socket.id, proposalId: data.proposalId, option: data.option },
        'Proposal resolution received'
      );
      // TODO: Implement resolution logic
    });

    // Handle terminal resize
    socket.on(WS_EVENTS.TERMINAL_RESIZE, (data: { taskId: string; cols: number; rows: number }) => {
      logger.debug({ socketId: socket.id, ...data }, 'Terminal resize');
      // TODO: Forward to terminal manager
    });

    // Handle sync trigger
    socket.on(WS_EVENTS.SYNC_TRIGGER, () => {
      logger.info({ socketId: socket.id }, 'Manual sync triggered');
      // TODO: Trigger Planner sync
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
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
