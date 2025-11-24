import { createChildLogger } from '../utils/logger.js';
import { settingsRepository } from '../database/repositories/SettingsRepository.js';

const logger = createChildLogger('microsoft-graph');

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface PlannerTask {
  id: string;
  title: string;
  bucketId: string;
  percentComplete: number;
  priority: number;
  createdDateTime: string;
  dueDateTime?: string;
  assignments?: Record<string, unknown>;
}

interface PlannerPlan {
  id: string;
  title: string;
  owner: string;
}

interface PlannerBucket {
  id: string;
  name: string;
  planId: string;
  orderHint: string;
}

export class MicrosoftGraphService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  async getAccessToken(): Promise<string> {
    // Return cached token if valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const settings = await settingsRepository.getAzureSettings();
    if (!settings) {
      throw new Error('Azure settings not configured');
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials'
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json() as { error_description?: string };
      throw new Error(`Failed to get access token: ${errorData.error_description}`);
    }

    const data = await response.json() as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 60s buffer

    return this.accessToken;
  }

  private async graphRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();

    const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      logger.error({ endpoint, status: response.status, error }, 'Graph API request failed');
      throw new Error(`Graph API error: ${response.status} - ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<T>;
  }

  // Get all groups the service principal has access to
  async getGroups(): Promise<{ id: string; displayName: string }[]> {
    const result = await this.graphRequest<{ value: { id: string; displayName: string }[] }>('/groups?$select=id,displayName');
    return result.value;
  }

  // Get plans for a group
  async getGroupPlans(groupId: string): Promise<PlannerPlan[]> {
    const result = await this.graphRequest<{ value: PlannerPlan[] }>(`/groups/${groupId}/planner/plans`);
    return result.value;
  }

  // Get all plans from all groups
  async getPlans(): Promise<PlannerPlan[]> {
    try {
      const groups = await this.getGroups();
      const allPlans: PlannerPlan[] = [];

      for (const group of groups) {
        try {
          const plans = await this.getGroupPlans(group.id);
          allPlans.push(...plans);
        } catch (err) {
          // Skip groups where we don't have access to plans
          logger.debug({ groupId: group.id, groupName: group.displayName }, 'No plan access for group');
        }
      }

      return allPlans;
    } catch (error) {
      logger.error({ error }, 'Failed to get plans');
      throw error;
    }
  }

  // Get plan by ID
  async getPlan(planId: string): Promise<PlannerPlan> {
    return this.graphRequest<PlannerPlan>(`/planner/plans/${planId}`);
  }

  // Create a new Microsoft 365 group (required for Planner)
  async createGroup(displayName: string, mailNickname: string): Promise<{ id: string; displayName: string }> {
    return this.graphRequest<{ id: string; displayName: string }>('/groups', {
      method: 'POST',
      body: JSON.stringify({
        displayName,
        mailNickname,
        groupTypes: ['Unified'],
        mailEnabled: true,
        securityEnabled: false
      })
    });
  }

  // Create a new Planner plan in a group
  async createPlan(groupId: string, title: string): Promise<PlannerPlan> {
    return this.graphRequest<PlannerPlan>('/planner/plans', {
      method: 'POST',
      body: JSON.stringify({
        owner: groupId,
        title
      })
    });
  }

  // Get buckets for a plan
  async getBuckets(planId: string): Promise<PlannerBucket[]> {
    const result = await this.graphRequest<{ value: PlannerBucket[] }>(
      `/planner/plans/${planId}/buckets`
    );
    return result.value;
  }

  // Create bucket
  async createBucket(planId: string, name: string): Promise<PlannerBucket> {
    return this.graphRequest<PlannerBucket>('/planner/buckets', {
      method: 'POST',
      body: JSON.stringify({ planId, name, orderHint: ' !' })
    });
  }

  // Get tasks for a plan
  async getTasks(planId: string): Promise<PlannerTask[]> {
    const result = await this.graphRequest<{ value: PlannerTask[] }>(
      `/planner/plans/${planId}/tasks`
    );
    return result.value;
  }

  // Get task details
  async getTaskDetails(taskId: string): Promise<{ description: string; checklist: Record<string, unknown> }> {
    return this.graphRequest(`/planner/tasks/${taskId}/details`);
  }

  // Create task
  async createTask(planId: string, bucketId: string, title: string, details?: {
    dueDateTime?: string;
    priority?: number;
    description?: string;
  }): Promise<PlannerTask> {
    const task = await this.graphRequest<PlannerTask>('/planner/tasks', {
      method: 'POST',
      body: JSON.stringify({
        planId,
        bucketId,
        title,
        dueDateTime: details?.dueDateTime,
        priority: details?.priority ?? 5
      })
    });

    // Update task details if description provided
    if (details?.description) {
      await this.updateTaskDetails(task.id, { description: details.description });
    }

    return task;
  }

  // Update task
  async updateTask(taskId: string, updates: Partial<PlannerTask>, etag: string): Promise<PlannerTask> {
    return this.graphRequest<PlannerTask>(`/planner/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'If-Match': etag },
      body: JSON.stringify(updates)
    });
  }

  // Update task details
  async updateTaskDetails(taskId: string, details: { description?: string }, etag?: string): Promise<void> {
    // Get current details to get etag if not provided
    if (!etag) {
      const current = await this.graphRequest<{ '@odata.etag': string }>(`/planner/tasks/${taskId}/details`);
      etag = current['@odata.etag'];
    }

    await this.graphRequest(`/planner/tasks/${taskId}/details`, {
      method: 'PATCH',
      headers: { 'If-Match': etag },
      body: JSON.stringify(details)
    });
  }

  // Move task to bucket
  async moveTaskToBucket(taskId: string, bucketId: string, etag: string): Promise<void> {
    await this.graphRequest(`/planner/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'If-Match': etag },
      body: JSON.stringify({ bucketId })
    });
  }

  // Delete task
  async deleteTask(taskId: string, etag: string): Promise<void> {
    await this.graphRequest(`/planner/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'If-Match': etag }
    });
  }

  // Setup CDA plan with required buckets
  async setupCDAPlan(planId: string): Promise<{ buckets: PlannerBucket[] }> {
    logger.info({ planId }, 'Setting up CDA plan structure');

    const existingBuckets = await this.getBuckets(planId);
    const bucketNames = ['To Do', 'In Progress', 'Completed', 'Failed'];
    const createdBuckets: PlannerBucket[] = [];

    for (const name of bucketNames) {
      const existing = existingBuckets.find(b => b.name === name);
      if (existing) {
        createdBuckets.push(existing);
      } else {
        const bucket = await this.createBucket(planId, name);
        createdBuckets.push(bucket);
        logger.info({ bucketName: name, bucketId: bucket.id }, 'Created bucket');
      }
    }

    // Save bucket IDs to settings
    const plannerSettings = await settingsRepository.getPlannerSettings();
    await settingsRepository.set('planner', {
      ...plannerSettings,
      planId,
      buckets: {
        todo: createdBuckets.find(b => b.name === 'To Do')?.id || '',
        inProgress: createdBuckets.find(b => b.name === 'In Progress')?.id || '',
        done: createdBuckets.find(b => b.name === 'Completed')?.id || '',
        failed: createdBuckets.find(b => b.name === 'Failed')?.id || ''
      },
      configured: true
    });

    return { buckets: createdBuckets };
  }

  // Sync tasks from Planner to local database
  async syncTasks(): Promise<{ synced: number; created: number; updated: number }> {
    const plannerSettings = await settingsRepository.getPlannerSettings();
    if (!plannerSettings?.planId) {
      throw new Error('Planner not configured');
    }

    const tasks = await this.getTasks(plannerSettings.planId);
    logger.info({ count: tasks.length }, 'Fetched tasks from Planner');

    // TODO: Sync logic with local database
    return { synced: tasks.length, created: 0, updated: 0 };
  }
}

export const microsoftGraphService = new MicrosoftGraphService();
