import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { taskRepository } from '../database/repositories/TaskRepository.js';
import { executionRepository } from '../database/repositories/ExecutionRepository.js';
import { claudeCodeService } from '../services/ClaudeCodeService.js';
import { plannerSyncService } from '../services/PlannerSyncService.js';
import { createChildLogger } from '../utils/logger.js';
import { TASK_TYPES, TASK_STATUSES } from '@cda/shared';
import type { ApiResponse, Task } from '@cda/shared';

const logger = createChildLogger('task-routes');

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  type: z.enum(TASK_TYPES as unknown as [string, ...string[]]).default('development'),
  priority: z.number().int().min(1).max(10).default(5),
  requiredTools: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  type: z.enum(TASK_TYPES as unknown as [string, ...string[]]).optional(),
  status: z.enum(TASK_STATUSES as unknown as [string, ...string[]]).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  requiredTools: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(TASK_STATUSES as unknown as [string, ...string[]]).optional(),
  type: z.enum(TASK_TYPES as unknown as [string, ...string[]]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const taskRoutes: FastifyPluginAsync = async (fastify) => {
  // List all tasks
  fastify.get('/api/tasks', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;

    const { tasks, total } = await taskRepository.findAll({
      status: query.status as Task['status'],
      type: query.type as Task['type'],
      limit: query.limit,
      offset,
    });

    const response: ApiResponse<Task[]> = {
      success: true,
      data: tasks,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
      },
    };

    return response;
  });

  // Get task stats
  fastify.get('/api/tasks/stats', async () => {
    const stats = await taskRepository.getStats();
    return { success: true, data: stats };
  });

  // Get task by ID
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = await taskRepository.findById(request.params.id);

    if (!task) {
      reply.code(404);
      return { success: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }

    return { success: true, data: task };
  });

  // Create task
  fastify.post('/api/tasks', async (request, reply) => {
    const body = createTaskSchema.parse(request.body);

    const task = await taskRepository.create({
      ...body,
      status: 'pending',
      type: body.type as Task['type'],
    });

    // Auto-create in Planner (async, don't block)
    plannerSyncService.createPlannerTask(task).catch(err =>
      logger.warn({ err, taskId: task.id }, 'Failed to create Planner task')
    );

    reply.code(201);
    return { success: true, data: task };
  });

  // Sync all tasks to Planner
  fastify.post('/api/tasks/sync-planner', async () => {
    const result = await plannerSyncService.syncAllTasks();
    return {
      success: true,
      data: {
        message: `Synced ${result.synced} tasks to Planner`,
        synced: result.synced,
        failed: result.failed,
      },
    };
  });

  // Update task
  fastify.patch<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const body = updateTaskSchema.parse(request.body);
    const task = await taskRepository.update(request.params.id, body as Partial<Task>);

    if (!task) {
      reply.code(404);
      return { success: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }

    return { success: true, data: task };
  });

  // Delete task
  fastify.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const deleted = await taskRepository.delete(request.params.id);

    if (!deleted) {
      reply.code(404);
      return { success: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }

    return { success: true, data: { deleted: true } };
  });

  // Execute task
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/execute', async (request, reply) => {
    const task = await taskRepository.findById(request.params.id);

    if (!task) {
      reply.code(404);
      return { success: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }

    if (task.status === 'executing') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'TASK_ALREADY_RUNNING', message: 'Task is already executing' },
      };
    }

    // Update status to executing
    await taskRepository.updateStatus(task.id, 'executing');

    // Create execution record
    const execution = await executionRepository.create({
      taskId: task.id,
    });

    logger.info({ taskId: task.id, executionId: execution.id }, 'Starting task execution');

    // Execute asynchronously (don't await - fire and forget)
    (async () => {
      try {
        const result = await claudeCodeService.executeTask(
          execution.id,
          {
            title: task.title,
            description: task.description,
            type: task.type,
            requiredTools: task.requiredTools,
          }
        );

        // Update execution with result
        await executionRepository.complete(execution.id, {
          status: result.success ? 'completed' : 'failed',
          output: result.output,
          error: result.error,
          exitCode: result.exitCode,
        });

        // Update task status
        const updatedTask = await taskRepository.updateStatus(
          task.id,
          result.success ? 'completed' : 'failed'
        );

        // Get completed execution for sync
        const completedExecution = await executionRepository.findById(execution.id);

        // Sync to Planner (async, don't block)
        if (updatedTask && completedExecution) {
          plannerSyncService.syncTaskStatus(updatedTask).catch(err =>
            logger.warn({ err }, 'Failed to sync task status to Planner')
          );
          plannerSyncService.addExecutionResults(updatedTask, completedExecution).catch(err =>
            logger.warn({ err }, 'Failed to add execution results to Planner')
          );
        }

        logger.info(
          { taskId: task.id, executionId: execution.id, success: result.success },
          'Task execution completed'
        );
      } catch (error) {
        logger.error({ taskId: task.id, executionId: execution.id, error }, 'Task execution failed');

        await executionRepository.complete(execution.id, {
          status: 'failed',
          error: (error as Error).message,
          exitCode: 1,
        });

        const failedTask = await taskRepository.updateStatus(task.id, 'failed');
        const failedExecution = await executionRepository.findById(execution.id);

        // Sync failure to Planner
        if (failedTask && failedExecution) {
          plannerSyncService.syncTaskStatus(failedTask).catch(err =>
            logger.warn({ err }, 'Failed to sync failed task to Planner')
          );
          plannerSyncService.addExecutionResults(failedTask, failedExecution).catch(err =>
            logger.warn({ err }, 'Failed to add failure results to Planner')
          );
        }
      }
    })();

    // Return immediately with execution info
    return {
      success: true,
      data: {
        task: await taskRepository.findById(task.id),
        execution
      }
    };
  });

  // Cancel task execution
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', async (request, reply) => {
    const task = await taskRepository.findById(request.params.id);

    if (!task) {
      reply.code(404);
      return { success: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }

    if (task.status !== 'executing' && task.status !== 'queued') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'TASK_CANNOT_CANCEL', message: 'Task is not in a cancellable state' },
      };
    }

    // Find the active execution for this task
    const latestExecution = await executionRepository.findLatestByTaskId(task.id);

    if (latestExecution && latestExecution.status === 'running') {
      // Cancel the running process
      const cancelled = claudeCodeService.cancel(latestExecution.id);

      if (cancelled) {
        logger.info({ taskId: task.id, executionId: latestExecution.id }, 'Cancelled running execution');

        // Update execution status
        await executionRepository.complete(latestExecution.id, {
          status: 'cancelled',
          error: 'Cancelled by user',
          exitCode: 130,
        });
      }
    }

    const updatedTask = await taskRepository.updateStatus(task.id, 'cancelled');

    return { success: true, data: updatedTask };
  });
};
