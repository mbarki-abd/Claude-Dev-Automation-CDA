import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { proposalRepository } from '../database/repositories/ProposalRepository.js';
import type { ApiResponse, Proposal } from '@cda/shared';

const listQuerySchema = z.object({
  taskId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const resolveSchema = z.object({
  optionId: z.string().min(1),
});

export const proposalRoutes: FastifyPluginAsync = async (fastify) => {
  // List all proposals
  fastify.get('/api/proposals', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;

    const { proposals, total } = await proposalRepository.findAll({
      taskId: query.taskId,
      status: query.status as Proposal['status'],
      limit: query.limit,
      offset,
    });

    const response: ApiResponse<Proposal[]> = {
      success: true,
      data: proposals,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
      },
    };

    return response;
  });

  // Get pending proposals
  fastify.get('/api/proposals/pending', async () => {
    const proposals = await proposalRepository.findPending();
    return { success: true, data: proposals };
  });

  // Get proposal by ID
  fastify.get<{ Params: { id: string } }>('/api/proposals/:id', async (request, reply) => {
    const proposal = await proposalRepository.findById(request.params.id);

    if (!proposal) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'PROPOSAL_NOT_FOUND', message: 'Proposal not found' },
      };
    }

    return { success: true, data: proposal };
  });

  // Approve proposal with selected option
  fastify.post<{ Params: { id: string } }>('/api/proposals/:id/approve', async (request, reply) => {
    const proposal = await proposalRepository.findById(request.params.id);

    if (!proposal) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'PROPOSAL_NOT_FOUND', message: 'Proposal not found' },
      };
    }

    if (proposal.status !== 'pending') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'PROPOSAL_ALREADY_RESOLVED', message: 'Proposal has already been resolved' },
      };
    }

    const body = resolveSchema.parse(request.body);

    // Validate the option exists
    const optionExists = proposal.options.some((opt) => opt.id === body.optionId);
    if (!optionExists) {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_OPTION', message: 'Selected option does not exist' },
      };
    }

    const resolved = await proposalRepository.resolve(request.params.id, body.optionId);

    // TODO: Resume execution with selected option

    return { success: true, data: resolved };
  });

  // Reject proposal
  fastify.post<{ Params: { id: string } }>('/api/proposals/:id/reject', async (request, reply) => {
    const proposal = await proposalRepository.findById(request.params.id);

    if (!proposal) {
      reply.code(404);
      return {
        success: false,
        error: { code: 'PROPOSAL_NOT_FOUND', message: 'Proposal not found' },
      };
    }

    if (proposal.status !== 'pending') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'PROPOSAL_ALREADY_RESOLVED', message: 'Proposal has already been resolved' },
      };
    }

    const rejected = await proposalRepository.reject(request.params.id);

    // TODO: Handle rejection - possibly cancel execution or use default

    return { success: true, data: rejected };
  });
};
