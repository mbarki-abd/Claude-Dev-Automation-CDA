import { spawn } from 'child_process';
import { createChildLogger } from '../utils/logger.js';
import { taskRepository } from '../database/repositories/TaskRepository.js';
import type { Task, Execution } from '@cda/shared';

const logger = createChildLogger('planner-sync');

export interface PlannerConfig {
  planId: string;
  buckets: {
    todo: string;
    inProgress: string;
    completed: string;
    failed: string;
  };
  azCliPath: string;
}

export class PlannerSyncService {
  private config: PlannerConfig;

  constructor() {
    this.config = {
      planId: process.env.PLANNER_PLAN_ID || 'ctRnzrpOaEO3iPbe_cZpoZgAGBUM',
      buckets: {
        todo: process.env.PLANNER_BUCKET_TODO || 'Mu8B-7xwVEmTX1H9mTlxFJgAD8mg',
        inProgress: process.env.PLANNER_BUCKET_IN_PROGRESS || 'x-spEdLYFU-AumBQJEWIc5gAD7tV',
        completed: process.env.PLANNER_BUCKET_COMPLETED || 'MOzLmDGXWUGJcUqHK9vVgJgAKCeb',
        failed: process.env.PLANNER_BUCKET_FAILED || 'omNy8o9qi0inV9M6HSDCkJgAKCeb',
      },
      azCliPath: 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
    };
  }

  /**
   * Execute Azure CLI command and return JSON result
   */
  private async azRest(method: string, uri: string, body?: object, headers?: Record<string, string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');

      const args = [
        'rest',
        '--method', method,
        '--uri', uri,
      ];

      let tempFile: string | undefined;

      if (body) {
        // Write body to temp file to avoid shell escaping issues
        tempFile = path.join(os.tmpdir(), `cda-az-body-${Date.now()}.json`);
        fs.writeFileSync(tempFile, JSON.stringify(body), 'utf8');
        args.push('--body', `@${tempFile}`);
      }

      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          args.push('--headers', `${key}=${value}`);
        }
      }

      args.push('--headers', 'Content-Type=application/json');

      logger.debug({ method, uri, body }, 'Executing Azure CLI REST call');

      // Use quoted path for Windows paths with spaces
      const azProcess = spawn(`"${this.config.azCliPath}"`, args, {
        shell: true,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      azProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      azProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      azProcess.on('close', (code) => {
        // Cleanup temp file
        if (tempFile) {
          try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
        }

        if (code === 0) {
          try {
            const result = stdout ? JSON.parse(stdout) : null;
            resolve(result);
          } catch {
            resolve(stdout);
          }
        } else {
          logger.error({ code, stderr }, 'Azure CLI command failed');
          reject(new Error(stderr || `Azure CLI exited with code ${code}`));
        }
      });

      azProcess.on('error', (err) => {
        // Cleanup temp file
        if (tempFile) {
          try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
        }
        reject(err);
      });
    });
  }

  /**
   * Create a task in Planner and link it to CDA
   */
  async createPlannerTask(cdaTask: Task): Promise<string | null> {
    try {
      const bucketId = this.getBucketForStatus(cdaTask.status);

      const plannerTask = await this.azRest('POST', 'https://graph.microsoft.com/v1.0/planner/tasks', {
        planId: this.config.planId,
        bucketId,
        title: `[CDA] ${cdaTask.title}`,
        priority: this.mapPriority(cdaTask.priority),
      }) as { id: string };

      if (plannerTask?.id) {
        // Update CDA task with Planner ID
        await taskRepository.update(cdaTask.id, { plannerId: plannerTask.id });

        // Add description if available
        if (cdaTask.description) {
          await this.updatePlannerTaskDetails(plannerTask.id, cdaTask.description);
        }

        logger.info({ cdaTaskId: cdaTask.id, plannerTaskId: plannerTask.id }, 'Created Planner task');
        return plannerTask.id;
      }

      return null;
    } catch (error) {
      logger.error({ error, cdaTaskId: cdaTask.id }, 'Failed to create Planner task');
      return null;
    }
  }

  /**
   * Update Planner task details (description)
   */
  private async updatePlannerTaskDetails(taskId: string, description: string): Promise<void> {
    try {
      // Get current details to get etag
      const details = await this.azRest('GET', `https://graph.microsoft.com/v1.0/planner/tasks/${taskId}/details`) as { '@odata.etag': string };
      const etag = details?.['@odata.etag'];

      if (etag) {
        await this.azRest('PATCH', `https://graph.microsoft.com/v1.0/planner/tasks/${taskId}/details`,
          { description },
          { 'If-Match': etag }
        );
      }
    } catch (error) {
      logger.warn({ error, taskId }, 'Failed to update Planner task details');
    }
  }

  /**
   * Sync CDA task status to Planner
   */
  async syncTaskStatus(cdaTask: Task): Promise<void> {
    if (!cdaTask.plannerId) {
      logger.debug({ cdaTaskId: cdaTask.id }, 'No Planner ID linked, creating new task');
      await this.createPlannerTask(cdaTask);
      return;
    }

    try {
      // Get current task to get etag
      const plannerTask = await this.azRest('GET', `https://graph.microsoft.com/v1.0/planner/tasks/${cdaTask.plannerId}`) as { '@odata.etag': string; bucketId: string };
      const etag = plannerTask?.['@odata.etag'];
      const targetBucket = this.getBucketForStatus(cdaTask.status);

      if (etag && plannerTask.bucketId !== targetBucket) {
        // Move to correct bucket
        await this.azRest('PATCH', `https://graph.microsoft.com/v1.0/planner/tasks/${cdaTask.plannerId}`,
          { bucketId: targetBucket },
          { 'If-Match': etag }
        );
        logger.info({ cdaTaskId: cdaTask.id, plannerId: cdaTask.plannerId, bucket: targetBucket }, 'Moved Planner task to bucket');
      }
    } catch (error) {
      logger.error({ error, cdaTaskId: cdaTask.id }, 'Failed to sync task status to Planner');
    }
  }

  /**
   * Add execution results as a comment/update to Planner task
   */
  async addExecutionResults(cdaTask: Task, execution: Execution): Promise<void> {
    if (!cdaTask.plannerId) {
      logger.debug({ cdaTaskId: cdaTask.id }, 'No Planner ID linked, cannot add results');
      return;
    }

    try {
      // Get current details
      const details = await this.azRest('GET', `https://graph.microsoft.com/v1.0/planner/tasks/${cdaTask.plannerId}/details`) as {
        '@odata.etag': string;
        description: string;
      };
      const etag = details?.['@odata.etag'];

      // Build execution summary
      const summary = this.buildExecutionSummary(execution);
      const newDescription = details.description
        ? `${details.description}\n\n---\n\n${summary}`
        : summary;

      if (etag) {
        await this.azRest('PATCH', `https://graph.microsoft.com/v1.0/planner/tasks/${cdaTask.plannerId}/details`,
          { description: newDescription.substring(0, 8000) }, // Planner has max description length
          { 'If-Match': etag }
        );
        logger.info({ cdaTaskId: cdaTask.id, executionId: execution.id }, 'Added execution results to Planner');
      }
    } catch (error) {
      logger.error({ error, cdaTaskId: cdaTask.id }, 'Failed to add execution results to Planner');
    }
  }

  /**
   * Build execution summary for Planner
   */
  private buildExecutionSummary(execution: Execution): string {
    const status = execution.status === 'completed' ? '✅ SUCCESS' : '❌ FAILED';
    const duration = execution.durationMs ? `${(execution.durationMs / 1000).toFixed(1)}s` : 'N/A';

    let summary = `## Execution ${status}\n`;
    summary += `- **Execution ID:** ${execution.id}\n`;
    summary += `- **Status:** ${execution.status}\n`;
    summary += `- **Duration:** ${duration}\n`;
    summary += `- **Exit Code:** ${execution.exitCode ?? 'N/A'}\n`;
    summary += `- **Completed:** ${execution.completedAt?.toISOString() ?? 'N/A'}\n\n`;

    if (execution.output) {
      summary += `### Claude Code Output\n\`\`\`\n${execution.output.substring(0, 2000)}\n\`\`\`\n`;
    }

    if (execution.error) {
      summary += `### Error\n\`\`\`\n${execution.error.substring(0, 1000)}\n\`\`\`\n`;
    }

    return summary;
  }

  /**
   * Get bucket ID for task status
   */
  private getBucketForStatus(status: Task['status']): string {
    switch (status) {
      case 'pending':
      case 'queued':
        return this.config.buckets.todo;
      case 'executing':
        return this.config.buckets.inProgress;
      case 'completed':
        return this.config.buckets.completed;
      case 'failed':
      case 'cancelled':
        return this.config.buckets.failed;
      default:
        return this.config.buckets.todo;
    }
  }

  /**
   * Map CDA priority (1-10) to Planner priority (1-9)
   */
  private mapPriority(cdaPriority: number): number {
    // CDA: 1-10 (1=highest), Planner: 1-9 (1=urgent, 5=normal, 9=low)
    if (cdaPriority <= 2) return 1; // Urgent
    if (cdaPriority <= 4) return 3; // Important
    if (cdaPriority <= 6) return 5; // Medium
    if (cdaPriority <= 8) return 7; // Low
    return 9; // Very Low
  }

  /**
   * Sync all unlinked CDA tasks to Planner
   */
  async syncAllTasks(): Promise<{ synced: number; failed: number }> {
    const { tasks } = await taskRepository.findAll({ limit: 100 });
    let synced = 0;
    let failed = 0;

    for (const task of tasks) {
      try {
        if (!task.plannerId) {
          await this.createPlannerTask(task);
        } else {
          await this.syncTaskStatus(task);
        }
        synced++;
      } catch {
        failed++;
      }
    }

    return { synced, failed };
  }
}

// Singleton instance
export const plannerSyncService = new PlannerSyncService();
