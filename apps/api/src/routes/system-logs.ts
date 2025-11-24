import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ApiResponse, PaginatedResponse, SystemLog, SystemLogLevel, SystemLogCategory } from '@cda/shared';
import { systemLogRepository } from '../database/repositories/SystemLogRepository.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('system-logs');

// Add a system log entry (persisted to database)
export async function addSystemLog(
  level: SystemLogLevel,
  category: SystemLogCategory,
  source: string,
  message: string,
  options?: {
    details?: string;
    taskId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<SystemLog> {
  try {
    const log = await systemLogRepository.create({
      level,
      category,
      source,
      message,
      details: options?.details,
      taskId: options?.taskId,
      metadata: options?.metadata,
    });

    logger.debug({ log }, 'System log added');
    return log;
  } catch (error) {
    logger.error({ error, level, category, source, message }, 'Failed to persist system log');
    // Return a fallback in-memory log if database fails
    return {
      id: `fallback-${Date.now()}`,
      level,
      category,
      source,
      message,
      details: options?.details,
      taskId: options?.taskId,
      metadata: options?.metadata,
      timestamp: new Date(),
    };
  }
}

// Query params schema
const listQuerySchema = z.object({
  category: z.enum(['planner', 'api', 'execution', 'system']).optional(),
  level: z.enum(['info', 'warning', 'error', 'success']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const systemLogsRoutes: FastifyPluginAsync = async (fastify) => {
  // List system logs
  fastify.get<{
    Querystring: z.infer<typeof listQuerySchema>;
  }>('/api/system-logs', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;

    const { logs, total } = await systemLogRepository.findAll({
      category: query.category as SystemLogCategory,
      level: query.level as SystemLogLevel,
      limit: query.limit,
      offset,
    });

    const totalPages = Math.ceil(total / query.limit);

    const response: PaginatedResponse<SystemLog> = {
      success: true,
      data: logs,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };

    return response;
  });

  // Get a specific log by ID
  fastify.get<{
    Params: { id: string };
  }>('/api/system-logs/:id', async (request, reply) => {
    const { id } = request.params;
    const log = await systemLogRepository.findById(id);

    if (!log) {
      reply.code(404);
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `System log ${id} not found`,
        },
      };
    }

    const response: ApiResponse<SystemLog> = {
      success: true,
      data: log,
    };

    return response;
  });

  // Cleanup old logs (admin endpoint)
  fastify.delete('/api/system-logs/cleanup', async () => {
    const deleted = await systemLogRepository.deleteOlderThan(30); // Delete logs older than 30 days
    return {
      success: true,
      data: { deleted },
    };
  });
};
