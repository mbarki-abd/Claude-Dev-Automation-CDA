import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { executionRepository } from '../database/repositories/ExecutionRepository.js';
import type { ApiResponse, Execution } from '@cda/shared';

const listQuerySchema = z.object({
  taskId: z.string().uuid().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'timeout']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const executionRoutes: FastifyPluginAsync = async (fastify) => {
  // List all executions
  fastify.get('/api/executions', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;

    const { executions, total } = await executionRepository.findAll({
      taskId: query.taskId,
      status: query.status as Execution['status'],
      limit: query.limit,
      offset,
    });

    const response: ApiResponse<Execution[]> = {
      success: true,
      data: executions,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
      },
    };

    return response;
  });

  // Get execution by ID
  fastify.get<{ Params: { id: string } }>('/api/executions/:id', async (request, reply) => {
    const execution = await executionRepository.findById(request.params.id);

    if (!execution) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'EXECUTION_NOT_FOUND', message: 'Execution not found' },
      };
    }

    return { success: true, data: execution };
  });

  // Get execution logs
  fastify.get<{ Params: { id: string } }>('/api/executions/:id/logs', async (request, reply) => {
    const execution = await executionRepository.findById(request.params.id);

    if (!execution) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'EXECUTION_NOT_FOUND', message: 'Execution not found' },
      };
    }

    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(10000).default(1000),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);

    const logs = await executionRepository.getLogs(request.params.id, {
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data: logs };
  });

  // Stream execution output (for real-time streaming, will use WebSocket)
  fastify.get<{ Params: { id: string } }>('/api/executions/:id/output', async (request, reply) => {
    const execution = await executionRepository.findById(request.params.id);

    if (!execution) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'EXECUTION_NOT_FOUND', message: 'Execution not found' },
      };
    }

    // For running executions, this will be handled via WebSocket
    // For completed executions, return the full output
    if (execution.status === 'running') {
      return {
        success: true,
        data: {
          status: 'streaming',
          message: 'Connect via WebSocket for live output',
          websocketPath: `/ws/executions/${request.params.id}`,
        },
      };
    }

    return {
      success: true,
      data: {
        status: execution.status,
        output: execution.output,
        error: execution.error,
        exitCode: execution.exitCode,
      },
    };
  });

  // Cancel execution
  fastify.post<{ Params: { id: string } }>('/api/executions/:id/cancel', async (request, reply) => {
    const execution = await executionRepository.findById(request.params.id);

    if (!execution) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'EXECUTION_NOT_FOUND', message: 'Execution not found' },
      };
    }

    if (execution.status !== 'running') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'EXECUTION_NOT_RUNNING', message: 'Execution is not running' },
      };
    }

    // TODO: Actually stop the container/process

    const updated = await executionRepository.complete(request.params.id, {
      status: 'cancelled',
    });

    return { success: true, data: updated };
  });
};
