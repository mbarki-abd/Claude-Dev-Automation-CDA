import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { taskRepository } from '../database/repositories/TaskRepository.js';
import { TASK_TYPES, TASK_STATUSES } from '@cda/shared';
import type { ApiResponse, Task } from '@cda/shared';

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
  fastify.get('/api/tasks', async (request, reply) => {
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

    reply.code(201);
    return { success: true, data: task };
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
    const updatedTask = await taskRepository.updateStatus(task.id, 'executing');

    // TODO: Trigger actual execution via ExecutionEngine
    // This will be implemented when we add the execution queue

    return { success: true, data: updatedTask };
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

    const updatedTask = await taskRepository.updateStatus(task.id, 'cancelled');

    // TODO: Actually cancel the running execution

    return { success: true, data: updatedTask };
  });
};
