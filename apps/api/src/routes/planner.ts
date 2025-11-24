import { FastifyPluginAsync } from 'fastify';
import { microsoftGraphService } from '../services/MicrosoftGraphService.js';
import { settingsRepository } from '../database/repositories/SettingsRepository.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('planner-routes');

export const plannerRoutes: FastifyPluginAsync = async (fastify) => {
  // Get available plans
  fastify.get('/api/planner/plans', async (_request, reply) => {
    try {
      const plans = await microsoftGraphService.getPlans();
      return { success: true, data: plans };
    } catch (error) {
      logger.error({ error }, 'Failed to get plans');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Create new CDA plan (group + plan + buckets)
  fastify.post('/api/planner/create', async (request, reply) => {
    const { name = 'Claude Dev Automation' } = request.body as { name?: string };

    try {
      // Create M365 group
      const timestamp = Date.now();
      const mailNickname = `cda-${timestamp}`;
      logger.info({ displayName: name, mailNickname }, 'Creating M365 group');

      const group = await microsoftGraphService.createGroup(name, mailNickname);
      logger.info({ groupId: group.id }, 'Created M365 group');

      // Wait for group provisioning
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Create plan in the group
      const plan = await microsoftGraphService.createPlan(group.id, `${name} Tasks`);
      logger.info({ planId: plan.id }, 'Created Planner plan');

      // Setup buckets
      const result = await microsoftGraphService.setupCDAPlan(plan.id);
      logger.info({ buckets: result.buckets.length }, 'Created buckets');

      return {
        success: true,
        data: {
          group,
          plan,
          buckets: result.buckets
        }
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create plan');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Get current plan details
  fastify.get('/api/planner/current', async (_request, reply) => {
    try {
      const settings = await settingsRepository.getPlannerSettings();
      if (!settings?.planId) {
        return { success: true, data: null };
      }

      const plan = await microsoftGraphService.getPlan(settings.planId);
      const buckets = await microsoftGraphService.getBuckets(settings.planId);
      const tasks = await microsoftGraphService.getTasks(settings.planId);

      return {
        success: true,
        data: {
          plan,
          buckets,
          tasks,
          settings
        }
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get current plan');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Setup plan with CDA buckets
  fastify.post('/api/planner/setup', async (request, reply) => {
    const { planId } = request.body as { planId: string };

    if (!planId) {
      reply.code(400);
      return { success: false, error: { message: 'planId is required' } };
    }

    try {
      const result = await microsoftGraphService.setupCDAPlan(planId);
      return { success: true, data: result };
    } catch (error) {
      logger.error({ error, planId }, 'Failed to setup plan');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Get buckets for a plan
  fastify.get('/api/planner/plans/:planId/buckets', async (request, reply) => {
    const { planId } = request.params as { planId: string };

    try {
      const buckets = await microsoftGraphService.getBuckets(planId);
      return { success: true, data: buckets };
    } catch (error) {
      logger.error({ error, planId }, 'Failed to get buckets');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Get tasks for current plan
  fastify.get('/api/planner/tasks', async (_request, reply) => {
    try {
      const settings = await settingsRepository.getPlannerSettings();
      if (!settings?.planId) {
        reply.code(400);
        return { success: false, error: { message: 'Planner not configured' } };
      }

      const tasks = await microsoftGraphService.getTasks(settings.planId);
      return { success: true, data: tasks };
    } catch (error) {
      logger.error({ error }, 'Failed to get tasks');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Create task in Planner
  fastify.post('/api/planner/tasks', async (request, reply) => {
    const { title, description, bucketId, priority, dueDateTime } = request.body as {
      title: string;
      description?: string;
      bucketId?: string;
      priority?: number;
      dueDateTime?: string;
    };

    if (!title) {
      reply.code(400);
      return { success: false, error: { message: 'title is required' } };
    }

    try {
      const settings = await settingsRepository.getPlannerSettings();
      if (!settings?.planId) {
        reply.code(400);
        return { success: false, error: { message: 'Planner not configured' } };
      }

      // Use todo bucket if not specified
      const targetBucket = bucketId || settings.buckets?.todo;
      if (!targetBucket) {
        reply.code(400);
        return { success: false, error: { message: 'No bucket specified and todo bucket not configured' } };
      }

      const task = await microsoftGraphService.createTask(
        settings.planId,
        targetBucket,
        title,
        { description, priority, dueDateTime }
      );

      logger.info({ taskId: task.id, title }, 'Created task in Planner');
      return { success: true, data: task };
    } catch (error) {
      logger.error({ error }, 'Failed to create task');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Sync tasks from Planner
  fastify.post('/api/planner/sync', async (_request, reply) => {
    try {
      const result = await microsoftGraphService.syncTasks();
      return { success: true, data: result };
    } catch (error) {
      logger.error({ error }, 'Failed to sync tasks');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });

  // Create a test task
  fastify.post('/api/planner/test-task', async (_request, reply) => {
    try {
      const settings = await settingsRepository.getPlannerSettings();
      if (!settings?.planId || !settings.buckets?.todo) {
        reply.code(400);
        return { success: false, error: { message: 'Planner not configured. Run setup first.' } };
      }

      const task = await microsoftGraphService.createTask(
        settings.planId,
        settings.buckets.todo,
        '[CDA Test] Hello World Script',
        {
          description: `Create a simple hello world script.

Requirements:
- Create a file called hello.js
- Print "Hello from Claude Dev Automation!"
- The script should be executable

This is a test task to verify the CDA pipeline.`,
          priority: 5
        }
      );

      logger.info({ taskId: task.id }, 'Created test task in Planner');
      return { success: true, data: task };
    } catch (error) {
      logger.error({ error }, 'Failed to create test task');
      reply.code(500);
      return { success: false, error: { message: (error as Error).message } };
    }
  });
};
