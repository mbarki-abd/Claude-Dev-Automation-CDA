import { query } from '../client.js';
import type { Proposal, ProposalStatus, ProposalType, ProposalOption } from '@cda/shared';

interface ProposalRow {
  id: string;
  task_id: string;
  execution_id: string | null;
  type: ProposalType;
  title: string;
  description: string | null;
  options: ProposalOption[];
  recommendation: string | null;
  status: ProposalStatus;
  resolution: string | null;
  resolved_by: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    taskId: row.task_id,
    executionId: row.execution_id ?? undefined,
    type: row.type,
    title: row.title,
    description: row.description ?? undefined,
    options: row.options,
    recommendation: row.recommendation ?? undefined,
    status: row.status,
    resolution: row.resolution ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export class ProposalRepository {
  async findAll(options?: {
    taskId?: string;
    status?: ProposalStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ proposals: Proposal[]; total: number }> {
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

    const [proposalsResult, countResult] = await Promise.all([
      query<ProposalRow>(
        `SELECT * FROM proposals ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM proposals ${whereClause}`, params),
    ]);

    return {
      proposals: proposalsResult.rows.map(rowToProposal),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async findPending(): Promise<Proposal[]> {
    const result = await query<ProposalRow>(
      "SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at ASC"
    );
    return result.rows.map(rowToProposal);
  }

  async findById(id: string): Promise<Proposal | null> {
    const result = await query<ProposalRow>('SELECT * FROM proposals WHERE id = $1', [id]);
    return result.rows[0] ? rowToProposal(result.rows[0]) : null;
  }

  async findByTaskId(taskId: string): Promise<Proposal[]> {
    const result = await query<ProposalRow>(
      'SELECT * FROM proposals WHERE task_id = $1 ORDER BY created_at DESC',
      [taskId]
    );
    return result.rows.map(rowToProposal);
  }

  async create(proposal: Omit<Proposal, 'id' | 'createdAt' | 'status'>): Promise<Proposal> {
    const result = await query<ProposalRow>(
      `INSERT INTO proposals (
        task_id, execution_id, type, title, description, options, recommendation
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        proposal.taskId,
        proposal.executionId ?? null,
        proposal.type,
        proposal.title,
        proposal.description ?? null,
        JSON.stringify(proposal.options),
        proposal.recommendation ?? null,
      ]
    );

    return rowToProposal(result.rows[0]);
  }

  async resolve(
    id: string,
    resolution: string,
    resolvedBy?: string
  ): Promise<Proposal | null> {
    const result = await query<ProposalRow>(
      `UPDATE proposals
       SET status = 'approved', resolution = $2, resolved_by = $3, resolved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, resolution, resolvedBy ?? null]
    );

    return result.rows[0] ? rowToProposal(result.rows[0]) : null;
  }

  async reject(id: string, resolvedBy?: string): Promise<Proposal | null> {
    const result = await query<ProposalRow>(
      `UPDATE proposals
       SET status = 'rejected', resolved_by = $2, resolved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, resolvedBy ?? null]
    );

    return result.rows[0] ? rowToProposal(result.rows[0]) : null;
  }

  async expire(id: string): Promise<Proposal | null> {
    const result = await query<ProposalRow>(
      `UPDATE proposals
       SET status = 'expired', resolved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id]
    );

    return result.rows[0] ? rowToProposal(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM proposals WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const proposalRepository = new ProposalRepository();
