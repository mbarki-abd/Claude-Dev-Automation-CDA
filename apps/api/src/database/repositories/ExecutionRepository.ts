import { query } from '../client.js';
import type { Execution, ExecutionStatus, ExecutionLog } from '@cda/shared';

interface ExecutionRow {
  id: string;
  task_id: string;
  status: ExecutionStatus;
  container_id: string | null;
  output: string | null;
  error: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  artifacts: Record<string, unknown> | null;
  started_at: Date;
  completed_at: Date | null;
}

interface ExecutionLogRow {
  id: string;
  execution_id: string;
  timestamp: Date;
  stream: 'stdout' | 'stderr';
  data: string;
}

function rowToExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    containerId: row.container_id ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    exitCode: row.exit_code ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    artifacts: row.artifacts ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function rowToLog(row: ExecutionLogRow): ExecutionLog {
  return {
    id: row.id,
    executionId: row.execution_id,
    timestamp: row.timestamp,
    stream: row.stream,
    data: row.data,
  };
}

export class ExecutionRepository {
  async findAll(options?: {
    taskId?: string;
    status?: ExecutionStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ executions: Execution[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.taskId) {
      conditions.push(`task_id = $${paramIndex++}`);
      params.push(options.taskId);
    }

    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [executionsResult, countResult] = await Promise.all([
      query<ExecutionRow>(
        `SELECT * FROM executions ${whereClause} ORDER BY started_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM executions ${whereClause}`, params),
    ]);

    return {
      executions: executionsResult.rows.map(rowToExecution),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async findById(id: string): Promise<Execution | null> {
    const result = await query<ExecutionRow>('SELECT * FROM executions WHERE id = $1', [id]);
    return result.rows[0] ? rowToExecution(result.rows[0]) : null;
  }

  async findByTaskId(taskId: string): Promise<Execution[]> {
    const result = await query<ExecutionRow>(
      'SELECT * FROM executions WHERE task_id = $1 ORDER BY started_at DESC',
      [taskId]
    );
    return result.rows.map(rowToExecution);
  }

  async findLatestByTaskId(taskId: string): Promise<Execution | null> {
    const result = await query<ExecutionRow>(
      'SELECT * FROM executions WHERE task_id = $1 ORDER BY started_at DESC LIMIT 1',
      [taskId]
    );
    return result.rows[0] ? rowToExecution(result.rows[0]) : null;
  }

  async create(execution: {
    taskId: string;
    containerId?: string;
  }): Promise<Execution> {
    const result = await query<ExecutionRow>(
      `INSERT INTO executions (task_id, container_id, status)
       VALUES ($1, $2, 'running')
       RETURNING *`,
      [execution.taskId, execution.containerId ?? null]
    );

    return rowToExecution(result.rows[0]);
  }

  async update(id: string, updates: Partial<Execution>): Promise<Execution | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    const fieldMappings: Record<string, string> = {
      taskId: 'task_id',
      containerId: 'container_id',
      exitCode: 'exit_code',
      durationMs: 'duration_ms',
      completedAt: 'completed_at',
    };

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'startedAt') continue;

      const dbField = fieldMappings[key] ?? key;
      const serializedValue = key === 'artifacts' && value !== null ? JSON.stringify(value) : value;

      setClauses.push(`${dbField} = $${paramIndex++}`);
      params.push(serializedValue ?? null);
    }

    if (setClauses.length === 0) return this.findById(id);

    params.push(id);

    const result = await query<ExecutionRow>(
      `UPDATE executions SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    return result.rows[0] ? rowToExecution(result.rows[0]) : null;
  }

  async complete(
    id: string,
    result: {
      status: ExecutionStatus;
      output?: string;
      error?: string;
      exitCode?: number;
      artifacts?: Record<string, unknown>;
    }
  ): Promise<Execution | null> {
    const execution = await this.findById(id);
    if (!execution) return null;

    const durationMs = Date.now() - execution.startedAt.getTime();

    return this.update(id, {
      ...result,
      durationMs,
      completedAt: new Date(),
    });
  }

  async appendLog(executionId: string, stream: 'stdout' | 'stderr', data: string): Promise<void> {
    await query(
      'INSERT INTO execution_logs (execution_id, stream, data) VALUES ($1, $2, $3)',
      [executionId, stream, data]
    );
  }

  async getLogs(
    executionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ExecutionLog[]> {
    const limit = options?.limit ?? 1000;
    const offset = options?.offset ?? 0;

    const result = await query<ExecutionLogRow>(
      'SELECT * FROM execution_logs WHERE execution_id = $1 ORDER BY timestamp ASC LIMIT $2 OFFSET $3',
      [executionId, limit, offset]
    );

    return result.rows.map(rowToLog);
  }

  async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM executions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const executionRepository = new ExecutionRepository();
