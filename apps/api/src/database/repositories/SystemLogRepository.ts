import { query } from '../client.js';
import type { SystemLog, SystemLogLevel, SystemLogCategory } from '@cda/shared';

interface SystemLogRow {
  id: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  source: string;
  message: string;
  details: string | null;
  task_id: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: Date;
}

function rowToSystemLog(row: SystemLogRow): SystemLog {
  return {
    id: row.id,
    level: row.level,
    category: row.category,
    source: row.source,
    message: row.message,
    details: row.details ?? undefined,
    taskId: row.task_id ?? undefined,
    metadata: row.metadata ?? undefined,
    timestamp: row.timestamp,
  };
}

export class SystemLogRepository {
  async findAll(options?: {
    category?: SystemLogCategory;
    level?: SystemLogLevel;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: SystemLog[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(options.category);
    }

    if (options?.level) {
      conditions.push(`level = $${paramIndex++}`);
      params.push(options.level);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [logsResult, countResult] = await Promise.all([
      query<SystemLogRow>(
        `SELECT * FROM system_logs ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM system_logs ${whereClause}`, params),
    ]);

    return {
      logs: logsResult.rows.map(rowToSystemLog),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async findById(id: string): Promise<SystemLog | null> {
    const result = await query<SystemLogRow>('SELECT * FROM system_logs WHERE id = $1', [id]);
    return result.rows[0] ? rowToSystemLog(result.rows[0]) : null;
  }

  async create(log: {
    level: SystemLogLevel;
    category: SystemLogCategory;
    source: string;
    message: string;
    details?: string;
    taskId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SystemLog> {
    const result = await query<SystemLogRow>(
      `INSERT INTO system_logs (level, category, source, message, details, task_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        log.level,
        log.category,
        log.source,
        log.message,
        log.details ?? null,
        log.taskId ?? null,
        log.metadata ? JSON.stringify(log.metadata) : null,
      ]
    );

    return rowToSystemLog(result.rows[0]);
  }

  async deleteOlderThan(days: number): Promise<number> {
    const result = await query(
      `DELETE FROM system_logs WHERE timestamp < NOW() - INTERVAL '${days} days'`
    );
    return result.rowCount ?? 0;
  }

  async getRecentByCategory(category: SystemLogCategory, limit = 10): Promise<SystemLog[]> {
    const result = await query<SystemLogRow>(
      `SELECT * FROM system_logs WHERE category = $1 ORDER BY timestamp DESC LIMIT $2`,
      [category, limit]
    );
    return result.rows.map(rowToSystemLog);
  }
}

export const systemLogRepository = new SystemLogRepository();
