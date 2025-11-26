import { FastifyPluginAsync } from 'fastify';
import { cliAuthService, AuthSession } from '../services/CLIAuthService.js';
import { cliAuthServiceV2 } from '../services/CLIAuthServiceV2.js';
import { autoAuthService } from '../services/AutoAuthService.js';
import { remoteAuthService, RemoteTarget, TokenResponse } from '../services/RemoteAuthService.js';
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

  // Get detailed Claude auth status with expiration info
  fastify.get('/api/cli-auth/claude-code/detailed-status', async (_request, _reply) => {
    try {
      const status = await cliAuthServiceV2.getDetailedClaudeAuthStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get detailed Claude auth status');
      return {
        success: false,
        error: { code: 'AUTH_CHECK_FAILED', message: 'Failed to check Claude authentication status' },
      };
    }
  });

  // Logout from Claude
  fastify.post('/api/cli-auth/claude-code/logout', async (_request, _reply) => {
    try {
      const result = await cliAuthServiceV2.logout();
      return {
        success: result.success,
        data: result.success ? { message: result.message } : undefined,
        error: result.success ? undefined : { code: 'LOGOUT_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to logout from Claude');
      return {
        success: false,
        error: { code: 'LOGOUT_ERROR', message: 'Failed to logout from Claude' },
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
  fastify.post('/api/cli-auth/claude-code/start', async (_request, reply) => {
    try {
      logger.info('Starting Claude Code authentication');
      const session = await cliAuthService.startClaudeCodeAuth();

      // Check if session failed immediately
      if (session.status === 'failed') {
        reply.code(503);
        return {
          success: false,
          error: { code: 'AUTH_START_FAILED', message: session.message || 'Failed to start Claude Code authentication' },
        };
      }

      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start Claude Code auth');
      reply.code(503);
      return {
        success: false,
        error: { code: 'AUTH_START_FAILED', message: 'Failed to start Claude Code authentication' },
      };
    }
  });

  // Azure auth handler function (shared)
  const handleAzureAuth = async (reply: any) => {
    try {
      logger.info('Starting Azure CLI authentication');
      const session = await cliAuthService.startAzureAuth();

      // Check if session failed immediately
      if (session.status === 'failed') {
        reply.code(503);
        return {
          success: false,
          error: { code: 'AUTH_START_FAILED', message: session.message || 'Failed to start Azure CLI authentication' },
        };
      }

      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start Azure CLI auth');
      reply.code(503);
      return {
        success: false,
        error: { code: 'AUTH_START_FAILED', message: 'Failed to start Azure CLI authentication' },
      };
    }
  };

  // Start Azure CLI authentication (both URL formats for compatibility)
  fastify.post('/api/cli-auth/azure-cli/start', async (_request, reply) => handleAzureAuth(reply));
  fastify.post('/api/cli-auth/azure/start', async (_request, reply) => handleAzureAuth(reply));

  // Start gcloud authentication (interactive device code)
  fastify.post('/api/cli-auth/gcloud/start', async (_request, reply) => {
    try {
      logger.info('Starting gcloud authentication');
      const session = await cliAuthService.startGCloudAuth();

      // Check if session failed immediately
      if (session.status === 'failed') {
        reply.code(503);
        return {
          success: false,
          error: { code: 'AUTH_START_FAILED', message: session.message || 'Failed to start gcloud authentication' },
        };
      }

      return {
        success: true,
        data: formatSession(session),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start gcloud auth');
      reply.code(503);
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

  // ============================================
  // AUTO-AUTH ENDPOINTS - Full Automation
  // ============================================

  // Setup API Key Helper (bypass OAuth with existing API key)
  fastify.post('/api/cli-auth/auto/setup-api-key', async (request, reply) => {
    const { apiKey } = request.body as { apiKey: string };

    if (!apiKey || typeof apiKey !== 'string') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_KEY', message: 'API key is required' },
      };
    }

    try {
      logger.info('Setting up API Key Helper for auto-auth');
      const result = await autoAuthService.setupApiKeyHelper(apiKey);
      return {
        success: result.success,
        data: result.success ? { message: result.message, method: result.method } : undefined,
        error: result.success ? undefined : { code: 'SETUP_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to setup API Key Helper');
      return {
        success: false,
        error: { code: 'SETUP_ERROR', message: 'Failed to setup API Key Helper' },
      };
    }
  });

  // Inject credentials directly (for use with Chrome extension)
  fastify.post('/api/cli-auth/auto/inject-credentials', async (request, reply) => {
    const { accessToken, refreshToken, expiresIn } = request.body as {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    };

    if (!accessToken || typeof accessToken !== 'string') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Access token is required' },
      };
    }

    try {
      logger.info('Injecting credentials for auto-auth');
      const result = await autoAuthService.injectCredentials(accessToken, refreshToken, expiresIn);
      return {
        success: result.success,
        data: result.success ? { message: result.message, method: result.method, credentials: result.credentials } : undefined,
        error: result.success ? undefined : { code: 'INJECT_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to inject credentials');
      return {
        success: false,
        error: { code: 'INJECT_ERROR', message: 'Failed to inject credentials' },
      };
    }
  });

  // Full auto-auth with Puppeteer (requires email/password)
  fastify.post('/api/cli-auth/auto/puppeteer', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email and password are required' },
      };
    }

    try {
      logger.info('Starting Puppeteer auto-auth');
      const result = await autoAuthService.automateOAuthWithPuppeteer(email, password);
      return {
        success: result.success,
        data: result.success ? { message: result.message, method: result.method } : undefined,
        error: result.success ? undefined : { code: 'PUPPETEER_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error }, 'Failed Puppeteer auto-auth');
      return {
        success: false,
        error: { code: 'PUPPETEER_ERROR', message: 'Failed to complete automated authentication' },
      };
    }
  });

  // Check auto-auth status
  fastify.get('/api/cli-auth/auto/status', async (_request, _reply) => {
    try {
      const status = await autoAuthService.checkAuthStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to check auto-auth status');
      return {
        success: false,
        error: { code: 'STATUS_ERROR', message: 'Failed to check authentication status' },
      };
    }
  });

  // ============================================
  // REMOTE AUTH ENDPOINTS - Credential Transfer
  // ============================================

  // Get local auth status (detailed)
  fastify.get('/api/cli-auth/local/status', async (_request, _reply) => {
    try {
      const status = await remoteAuthService.getLocalAuthStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get local auth status');
      return {
        success: false,
        error: { code: 'LOCAL_STATUS_ERROR', message: 'Failed to get local authentication status' },
      };
    }
  });

  // Get remote auth status
  fastify.get('/api/cli-auth/remote/status', async (request, _reply) => {
    const { host, user, port } = request.query as { host?: string; user?: string; port?: string };

    try {
      let target: RemoteTarget | undefined;
      if (host) {
        target = {
          type: 'ssh',
          host,
          user: user || 'root',
          port: port ? parseInt(port, 10) : 22
        };
      }

      const status = await remoteAuthService.getRemoteAuthStatus(target);
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get remote auth status');
      return {
        success: false,
        error: { code: 'REMOTE_STATUS_ERROR', message: 'Failed to get remote authentication status' },
      };
    }
  });

  // Transfer credentials from local to remote
  fastify.post('/api/cli-auth/remote/transfer', async (request, reply) => {
    const { host, user, port, privateKey, password } = request.body as {
      host?: string;
      user?: string;
      port?: number;
      privateKey?: string;
      password?: string;
    };

    try {
      let target: RemoteTarget | undefined;
      if (host) {
        target = {
          type: 'ssh',
          host,
          user: user || 'root',
          port: port || 22,
          privateKey,
          password
        };
      }

      logger.info({ target: host || 'default' }, 'Starting credential transfer');
      const result = await remoteAuthService.transferCredentials(target);

      return {
        success: result.success,
        data: result.success ? result : undefined,
        error: result.success ? undefined : { code: 'TRANSFER_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to transfer credentials');
      reply.code(500);
      return {
        success: false,
        error: { code: 'TRANSFER_ERROR', message: 'Failed to transfer credentials to remote server' },
      };
    }
  });

  // Sync credentials between local and remote
  fastify.post('/api/cli-auth/remote/sync', async (request, reply) => {
    const { direction, host, user, port } = request.body as {
      direction: 'to-remote' | 'from-remote';
      host?: string;
      user?: string;
      port?: number;
    };

    if (!direction || !['to-remote', 'from-remote'].includes(direction)) {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_DIRECTION', message: 'Direction must be "to-remote" or "from-remote"' },
      };
    }

    try {
      let target: RemoteTarget | undefined;
      if (host) {
        target = {
          type: 'ssh',
          host,
          user: user || 'root',
          port: port || 22
        };
      }

      logger.info({ direction, target: host || 'default' }, 'Starting credential sync');
      const result = await remoteAuthService.syncCredentials(direction, target);

      return {
        success: result.success,
        data: result,
        error: result.success ? undefined : { code: 'SYNC_FAILED', message: result.message },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to sync credentials');
      reply.code(500);
      return {
        success: false,
        error: { code: 'SYNC_ERROR', message: 'Failed to sync credentials' },
      };
    }
  });

  // Verify Claude CLI works on remote server
  fastify.post('/api/cli-auth/remote/verify', async (request, reply) => {
    const { host, user, port } = request.body as {
      host?: string;
      user?: string;
      port?: number;
    };

    try {
      let target: RemoteTarget | undefined;
      if (host) {
        target = {
          type: 'ssh',
          host,
          user: user || 'root',
          port: port || 22
        };
      }

      logger.info({ target: host || 'default' }, 'Verifying remote Claude CLI');
      const result = await remoteAuthService.verifyRemoteClaude(target);

      return {
        success: result.success,
        data: result,
        error: result.success ? undefined : { code: 'VERIFY_FAILED', message: result.output },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to verify remote Claude');
      reply.code(500);
      return {
        success: false,
        error: { code: 'VERIFY_ERROR', message: 'Failed to verify remote Claude CLI' },
      };
    }
  });

  // Set default remote target
  fastify.post('/api/cli-auth/remote/target', async (request, reply) => {
    const { host, user, port, privateKey, privateKeyPath, password, type } = request.body as {
      host: string;
      user?: string;
      port?: number;
      privateKey?: string;
      privateKeyPath?: string;
      password?: string;
      type?: 'ssh' | 'docker' | 'local';
    };

    if (!host && type !== 'local') {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_TARGET', message: 'Host is required for SSH targets' },
      };
    }

    try {
      const target: RemoteTarget = {
        type: type || 'ssh',
        host,
        user: user || 'root',
        port: port || 22,
        privateKey,
        privateKeyPath,
        password
      };

      remoteAuthService.setDefaultTarget(target);
      logger.info({ host }, 'Default remote target configured');

      return {
        success: true,
        data: { message: `Default target set to ${host || 'local'}`, target: { host, user: target.user, port: target.port } },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to set default target');
      reply.code(500);
      return {
        success: false,
        error: { code: 'TARGET_ERROR', message: 'Failed to set default target' },
      };
    }
  });

  // Get default remote target
  fastify.get('/api/cli-auth/remote/target', async (_request, _reply) => {
    try {
      const target = remoteAuthService.getDefaultTarget();
      return {
        success: true,
        data: target ? {
          type: target.type,
          host: target.host,
          user: target.user,
          port: target.port,
          hasPrivateKey: !!target.privateKey || !!target.privateKeyPath,
          hasPassword: !!target.password
        } : null,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get default target');
      return {
        success: false,
        error: { code: 'TARGET_ERROR', message: 'Failed to get default target' },
      };
    }
  });

  // ============================================
  // OAUTH FLOW ENDPOINTS - Chrome Extension
  // ============================================

  // Start OAuth flow (for Chrome extension)
  fastify.post('/api/cli-auth/oauth/start', async (_request, _reply) => {
    try {
      logger.info('Starting OAuth flow for Chrome extension');
      const session = remoteAuthService.startOAuthFlow();

      return {
        success: true,
        data: {
          sessionId: session.sessionId,
          authUrl: session.authUrl,
          codeVerifier: session.codeVerifier,
          expiresAt: session.expiresAt
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to start OAuth flow');
      return {
        success: false,
        error: { code: 'OAUTH_START_ERROR', message: 'Failed to start OAuth flow' },
      };
    }
  });

  // Handle OAuth callback (tokens from extension)
  fastify.post('/api/cli-auth/oauth/callback', async (request, reply) => {
    const { sessionId, tokens } = request.body as {
      sessionId: string;
      tokens: TokenResponse;
    };

    if (!sessionId || !tokens) {
      reply.code(400);
      return {
        success: false,
        error: { code: 'INVALID_CALLBACK', message: 'Session ID and tokens are required' },
      };
    }

    try {
      logger.info({ sessionId }, 'Processing OAuth callback');
      const status = await remoteAuthService.handleOAuthCallback(sessionId, tokens);

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to process OAuth callback');
      reply.code(400);
      return {
        success: false,
        error: { code: 'OAUTH_CALLBACK_ERROR', message: (error as Error).message },
      };
    }
  });

  // Get OAuth session status
  fastify.get('/api/cli-auth/oauth/session/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const session = remoteAuthService.getOAuthSession(sessionId);

      if (!session) {
        reply.code(404);
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'OAuth session not found or expired' },
        };
      }

      return {
        success: true,
        data: {
          sessionId: session.sessionId,
          authUrl: session.authUrl,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          expired: Date.now() > session.expiresAt
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get OAuth session');
      return {
        success: false,
        error: { code: 'SESSION_ERROR', message: 'Failed to get OAuth session' },
      };
    }
  });

  // ============================================
  // COMBINED STATUS ENDPOINT
  // ============================================

  // Get both local and remote auth status
  fastify.get('/api/cli-auth/combined/status', async (request, _reply) => {
    const { host, user, port } = request.query as { host?: string; user?: string; port?: string };

    try {
      let target: RemoteTarget | undefined;
      if (host) {
        target = {
          type: 'ssh',
          host,
          user: user || 'root',
          port: port ? parseInt(port, 10) : 22
        };
      }

      const [localStatus, remoteStatus] = await Promise.all([
        remoteAuthService.getLocalAuthStatus(),
        remoteAuthService.getRemoteAuthStatus(target).catch(() => ({
          authenticated: false,
          status: 'not_authenticated' as const,
          error: 'Remote connection failed'
        }))
      ]);

      return {
        success: true,
        data: {
          local: localStatus,
          remote: remoteStatus,
          synced: localStatus.authenticated && remoteStatus.authenticated &&
                  localStatus.expiresAt === (remoteStatus as any).expiresAt
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get combined auth status');
      return {
        success: false,
        error: { code: 'COMBINED_STATUS_ERROR', message: 'Failed to get combined authentication status' },
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
