import { FastifyPluginAsync } from 'fastify';
import { cliAuthService, AuthSession } from '../services/CLIAuthService.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('cli-auth-routes');

export const cliAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // Get auth status for all CLI tools
  fastify.get('/api/cli-auth/status', async (_request, _reply) => {
    try {
      const status = await cliAuthService.checkAllAuthStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to check auth status');
      return {
        success: false,
        error: { code: 'AUTH_CHECK_FAILED', message: 'Failed to check authentication status' },
      };
    }
  });

  // Get all active auth sessions
  fastify.get('/api/cli-auth/sessions', async (_request, _reply) => {
    try {
      const sessions = cliAuthService.getActiveSessions();
      return {
        success: true,
        data: sessions.map(formatSession),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get sessions');
      return {
        success: false,
        error: { code: 'SESSIONS_ERROR', message: 'Failed to get active sessions' },
      };
    }
  });

  // Get specific session
  fastify.get('/api/cli-auth/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      const session = cliAuthService.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
        };
      }
      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to get session');
      return {
        success: false,
        error: { code: 'SESSION_ERROR', message: 'Failed to get session' },
      };
    }
  });

  // Start Claude Code authentication
  fastify.post('/api/cli-auth/claude-code/start', async (_request, _reply) => {
    try {
      logger.info('Starting Claude Code authentication');
      const session = await cliAuthService.startClaudeCodeAuth();
      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start Claude Code auth');
      return {
        success: false,
        error: { code: 'AUTH_START_FAILED', message: 'Failed to start Claude Code authentication' },
      };
    }
  });

  // Start Azure CLI authentication
  fastify.post('/api/cli-auth/azure-cli/start', async (_request, _reply) => {
    try {
      logger.info('Starting Azure CLI authentication');
      const session = await cliAuthService.startAzureAuth();
      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start Azure CLI auth');
      return {
        success: false,
        error: { code: 'AUTH_START_FAILED', message: 'Failed to start Azure CLI authentication' },
      };
    }
  });

  // Start gcloud authentication (interactive device code)
  fastify.post('/api/cli-auth/gcloud/start', async (_request, _reply) => {
    try {
      logger.info('Starting gcloud authentication');
      const session = await cliAuthService.startGCloudAuth();
      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start gcloud auth');
      return {
        success: false,
        error: { code: 'AUTH_START_FAILED', message: 'Failed to start gcloud authentication' },
      };
    }
  });

  // Submit auth code for a session
  fastify.post('/api/cli-auth/sessions/:sessionId/submit-code', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { code } = request.body as { code: string };

    if (!code || typeof code !== 'string') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_CODE', message: 'Code is required' },
      };
    }

    try {
      logger.info({ sessionId, codeLength: code.length }, 'Submitting auth code');
      const result = await cliAuthService.submitAuthCode(sessionId, code);
      return {
        success: result.success,
        data: result.success ? { message: result.message } : undefined,
        error: result.success ? undefined : { code: 'SUBMIT_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to submit auth code');
      return {
        success: false,
        error: { code: 'SUBMIT_ERROR', message: 'Failed to submit authentication code' },
      };
    }
  });

  // Cancel a session
  fastify.post('/api/cli-auth/sessions/:sessionId/cancel', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      logger.info({ sessionId }, 'Cancelling auth session');
      const cancelled = cliAuthService.cancelSession(sessionId);
      if (!cancelled) {
        reply.code(404);
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or already completed' },
        };
      }
      return {
        success: true,
        data: { message: 'Session cancelled' },
      };
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to cancel session');
      return {
        success: false,
        error: { code: 'CANCEL_ERROR', message: 'Failed to cancel session' },
      };
    }
  });

  // Setup WebSocket for real-time auth updates
  // This is handled via Socket.IO in the main server

  logger.info('CLI Auth routes registered');
};

// Helper to format session for API response
function formatSession(session: AuthSession): Record<string, unknown> {
  return {
    id: session.id,
    tool: session.tool,
    status: session.status,
    authUrl: session.authUrl,
    userCode: session.userCode,
    message: session.message,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt?.toISOString(),
  };
}
