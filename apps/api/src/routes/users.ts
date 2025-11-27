import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { userRepository } from '../database/repositories/UserRepository.js';
import { authService } from '../services/AuthService.js';
import { unixAccountService } from '../services/UnixAccountService.js';

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  password: z.string().min(8).max(100),
  fullName: z.string().optional(),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
  fullName: z.string().optional(),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  avatarUrl: z.string().url().optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

const saveCredentialSchema = z.object({
  provider: z.enum(['azure', 'gcloud', 'anthropic', 'github', 'aws']),
  credentialType: z.enum(['oauth', 'api_key', 'service_account']),
  credentials: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
});

const saveClaudeAuthSchema = z.object({
  authMethod: z.enum(['oauth', 'api_key']),
  tokens: z.object({
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
  }).optional(),
  apiKey: z.string().optional(),
});

// Middleware to verify admin access
function requireAdmin(request: FastifyRequest, reply: FastifyReply): undefined {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
    });
    return;
  }

  const token = authHeader.substring(7);
  const payload = authService.verifyAccessToken(token);

  if (!payload) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
    return;
  }

  if (payload.role !== 'admin') {
    reply.code(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
    return;
  }

  (request as any).user = payload;
}

// Middleware to verify authenticated user
function requireAuth(request: FastifyRequest, reply: FastifyReply): undefined {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
    });
    return;
  }

  const token = authHeader.substring(7);
  const payload = authService.verifyAccessToken(token);

  if (!payload) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
    return;
  }

  (request as any).user = payload;
}

export async function userRoutes(fastify: FastifyInstance) {
  // List all users (admin only)
  fastify.get('/api/users', { preHandler: requireAdmin }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = request.query as { page?: string; limit?: string; status?: string; role?: string };

    const result = await userRepository.findAll({
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
      status: query.status,
      role: query.role,
    });

    // Remove password hashes
    const users = result.users.map(({ passwordHash, ...user }) => user);

    return {
      success: true,
      data: users,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
    };
  });

  // Create user (admin only)
  fastify.post('/api/users', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createUserSchema.parse(request.body);

    // Check if email already exists
    const existingEmail = await userRepository.findByEmail(body.email);
    if (existingEmail) {
      return reply.code(400).send({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'Email already registered' },
      });
    }

    // Check if username already exists
    const existingUsername = await userRepository.findByUsername(body.username);
    if (existingUsername) {
      return reply.code(400).send({
        success: false,
        error: { code: 'USERNAME_EXISTS', message: 'Username already taken' },
      });
    }

    const user = await userRepository.create(body);
    const { passwordHash, ...safeUser } = user;

    return {
      success: true,
      data: safeUser,
    };
  });

  // Get user by ID
  fastify.get('/api/users/:id', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    // Users can only view their own profile unless admin
    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const user = await userRepository.findById(id);

    if (!user) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    const { passwordHash, ...safeUser } = user;

    return {
      success: true,
      data: safeUser,
    };
  });

  // Update user
  fastify.patch('/api/users/:id', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;
    const body = updateUserSchema.parse(request.body);

    // Users can only update their own profile unless admin
    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    // Only admins can change role and status
    if (currentUser.role !== 'admin') {
      delete body.role;
      delete body.status;
    }

    const user = await userRepository.update(id, body);

    if (!user) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    const { passwordHash, ...safeUser } = user;

    return {
      success: true,
      data: safeUser,
    };
  });

  // Delete user (admin only)
  fastify.delete('/api/users/:id', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    // Prevent self-deletion
    if (currentUser.userId === id) {
      return reply.code(400).send({
        success: false,
        error: { code: 'SELF_DELETE', message: 'Cannot delete your own account' },
      });
    }

    // Delete Unix account first
    await unixAccountService.deleteUnixAccount(id);

    const deleted = await userRepository.delete(id);

    if (!deleted) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    return { success: true };
  });

  // Create Unix account for user
  fastify.post('/api/users/:id/unix-account', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { preferredUsername?: string };

    const result = await unixAccountService.createUnixAccount(id, body.preferredUsername);

    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'UNIX_ACCOUNT_FAILED', message: result.error },
      });
    }

    // Setup cloud CLI directories
    await unixAccountService.setupCloudCLIConfig(id);

    return {
      success: true,
      data: result,
    };
  });

  // Get Unix account info
  fastify.get('/api/users/:id/unix-account', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const info = await unixAccountService.getAccountInfo(id);

    if (!info) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    return {
      success: true,
      data: info,
    };
  });

  // Delete Unix account
  fastify.delete('/api/users/:id/unix-account', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const deleted = await unixAccountService.deleteUnixAccount(id);

    if (!deleted) {
      return reply.code(400).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete Unix account' },
      });
    }

    return { success: true };
  });

  // Get user credentials (providers only, not actual secrets)
  fastify.get('/api/users/:id/credentials', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const credentials = await userRepository.getUserCredentials(id);

    // Remove encrypted credentials, only return metadata
    const safeCredentials = credentials.map(({ credentialsEncrypted, ...cred }) => ({
      ...cred,
      hasCredentials: true,
    }));

    return {
      success: true,
      data: safeCredentials,
    };
  });

  // Save credential
  fastify.post('/api/users/:id/credentials', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;
    const body = saveCredentialSchema.parse(request.body);

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;

    const credential = await userRepository.saveCredential(
      id,
      body.provider,
      body.credentialType,
      body.credentials,
      undefined,
      expiresAt
    );

    return {
      success: true,
      data: {
        id: credential.id,
        provider: credential.provider,
        credentialType: credential.credentialType,
        status: credential.status,
        expiresAt: credential.expiresAt,
      },
    };
  });

  // Delete credential
  fastify.delete('/api/users/:id/credentials/:provider/:type', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, provider, type } = request.params as { id: string; provider: string; type: string };
    const currentUser = (request as any).user;

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const deleted = await userRepository.deleteCredential(id, provider, type);

    if (!deleted) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Credential not found' },
      });
    }

    return { success: true };
  });

  // Get Claude auth status
  fastify.get('/api/users/:id/claude-auth', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const auth = await userRepository.getClaudeAuth(id);

    if (!auth) {
      return {
        success: true,
        data: { configured: false },
      };
    }

    return {
      success: true,
      data: {
        configured: true,
        authMethod: auth.auth.authMethod,
        status: auth.auth.status,
        expiresAt: auth.auth.expiresAt,
        lastUsedAt: auth.auth.lastUsedAt,
      },
    };
  });

  // Save Claude auth
  fastify.post('/api/users/:id/claude-auth', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;
    const body = saveClaudeAuthSchema.parse(request.body);

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const tokens = body.tokens ? {
      accessToken: body.tokens.accessToken,
      refreshToken: body.tokens.refreshToken,
      expiresAt: body.tokens.expiresAt ? new Date(body.tokens.expiresAt) : undefined,
    } : undefined;

    const auth = await userRepository.saveClaudeAuth(id, body.authMethod, tokens, body.apiKey);

    return {
      success: true,
      data: {
        authMethod: auth.authMethod,
        status: auth.status,
        expiresAt: auth.expiresAt,
      },
    };
  });

  // Delete Claude auth
  fastify.delete('/api/users/:id/claude-auth', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    if (currentUser.role !== 'admin' && currentUser.userId !== id) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    await userRepository.deleteClaudeAuth(id);

    return { success: true };
  });
}
