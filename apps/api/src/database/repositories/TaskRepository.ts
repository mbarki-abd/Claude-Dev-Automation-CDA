import { query, transaction } from '../client.js';
import type { Task, TaskStatus, TaskType, TaskInterpretation } from '@cda/shared';

interface TaskRow {
  id: string;
  planner_id: string | null;
  title: string;
  description: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  complexity: string | null;
  estimated_duration: string | null;
  interpretation: TaskInterpretation | null;
  execution_plan: string[] | null;
  required_tools: string[];
  mcp_servers: string[];
  prerequisites: Record<string, unknown> | null;
  planner_bucket: string | null;
  planner_labels: string[] | null;
  assigned_to: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    plannerId: row.planner_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    type: row.type,
    status: row.status,
    priority: row.priority,
    complexity: row.complexity as Task['complexity'],
    estimatedDuration: row.estimated_duration ?? undefined,
    interpretation: row.interpretation ?? undefined,
    executionPlan: row.execution_plan ?? undefined,
    requiredTools: row.required_tools ?? [],
    mcpServers: row.mcp_servers ?? [],
    prerequisites: row.prerequisites ?? undefined,
    plannerBucket: row.planner_bucket ?? undefined,
    plannerLabels: row.planner_labels ?? undefined,
    assignedTo: row.assigned_to ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

export class TaskRepository {
  async findAll(options?: {
    status?: TaskStatus;
    type?: TaskType;
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: Task[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(options.status);
    }

    if (options?.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(options.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [tasksResult, countResult] = await Promise.all([
      query<TaskRow>(
        `SELECT * FROM tasks ${whereClause} ORDER BY priority ASC, created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM tasks ${whereClause}`, params),
    ]);

    return {
      tasks: tasksResult.rows.map(rowToTask),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async findById(id: string): Promise<Task | null> {
    const result = await query<TaskRow>('SELECT * FROM tasks WHERE id = $1', [id]);
    return result.rows[0] ? rowToTask(result.rows[0]) : null;
  }

  async findByPlannerId(plannerId: string): Promise<Task | null> {
    const result = await query<TaskRow>('SELECT * FROM tasks WHERE planner_id = $1', [plannerId]);
    return result.rows[0] ? rowToTask(result.rows[0]) : null;
  }

  async create(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const result = await query<TaskRow>(
      `INSERT INTO tasks (
        planner_id, title, description, type, status, priority,
        complexity, estimated_duration, interpretation, execution_plan,
        required_tools, mcp_servers, prerequisites, planner_bucket,
        planner_labels, assigned_to
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        task.plannerId ?? null,
        task.title,
        task.description ?? null,
        task.type,
        task.status,
        task.priority,
        task.complexity ?? null,
        task.estimatedDuration ?? null,
        task.interpretation ? JSON.stringify(task.interpretation) : null,
        task.executionPlan ? JSON.stringify(task.executionPlan) : null,
        task.requiredTools,
        task.mcpServers,
        task.prerequisites ? JSON.stringify(task.prerequisites) : null,
        task.plannerBucket ?? null,
        task.plannerLabels ?? null,
        task.assignedTo ?? null,
      ]
    );

    return rowToTask(result.rows[0]);
  }

  async update(id: string, updates: Partial<Task>): Promise<Task | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    const fieldMappings: Record<string, string> = {
      plannerId: 'planner_id',
      estimatedDuration: 'estimated_duration',
      executionPlan: 'execution_plan',
      requiredTools: 'required_tools',
      mcpServers: 'mcp_servers',
      plannerBucket: 'planner_bucket',
      plannerLabels: 'planner_labels',
      assignedTo: 'assigned_to',
      startedAt: 'started_at',
      completedAt: 'completed_at',
    };

    for (const [key, value] of Object.entries(updates)) {
      if (['id', 'createdAt', 'updatedAt'].includes(key)) continue;

      const dbField = fieldMappings[key] ?? key;
      const serializedValue =
        ['interpretation', 'executionPlan', 'prerequisites'].includes(key) && value !== null
          ? JSON.stringify(value)
          : value;

      setClauses.push(`${dbField} = $${paramIndex++}`);
      params.push(serializedValue ?? null);
    }

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query<TaskRow>(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    return result.rows[0] ? rowToTask(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task | null> {
    const updates: Partial<Task> = { status };

    if (status === 'executing') {
      updates.startedAt = new Date();
    } else if (['completed', 'failed', 'cancelled'].includes(status)) {
      updates.completedAt = new Date();
    }

    return this.update(id, updates);
  }

  async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM tasks WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  }> {
    const [totalResult, statusResult, typeResult] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) as count FROM tasks'),
      query<{ status: string; count: string }>(
        'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
      ),
      query<{ type: string; count: string }>(
        'SELECT type, COUNT(*) as count FROM tasks GROUP BY type'
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusResult.rows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    const byType: Record<string, number> = {};
    for (const row of typeResult.rows) {
      byType[row.type] = parseInt(row.count, 10);
    }

    return {
      total: parseInt(totalResult.rows[0].count, 10),
      byStatus,
      byType,
    };
  }
}

export const taskRepository = new TaskRepository();
