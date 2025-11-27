import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/AuthService.js';
import { userRepository } from '../database/repositories/UserRepository.js';

const signupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  password: z.string().min(8).max(100),
  fullName: z.string().optional(),
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(100),
});

export async function authRoutes(fastify: FastifyInstance) {
  // Signup
  fastify.post('/api/auth/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = signupSchema.parse(request.body);
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    const result = await authService.signup(body, ipAddress, userAgent);

    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'SIGNUP_FAILED', message: result.error },
      });
    }

    return {
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens,
      },
    };
  });

  // Login
  fastify.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    const result = await authService.login(body.emailOrUsername, body.password, ipAddress, userAgent);

    if (!result.success) {
      return reply.code(401).send({
        success: false,
        error: { code: 'LOGIN_FAILED', message: result.error },
      });
    }

    return {
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens,
      },
    };
  });

  // Refresh tokens
  fastify.post('/api/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = refreshSchema.parse(request.body);
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    const tokens = await authService.refreshTokens(body.refreshToken, ipAddress, userAgent);

    if (!tokens) {
      return reply.code(401).send({
        success: false,
        error: { code: 'REFRESH_FAILED', message: 'Invalid or expired refresh token' },
      });
    }

    return {
      success: true,
      data: { tokens },
    };
  });

  // Logout
  fastify.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const body = request.body as { refreshToken?: string } | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
      });
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyAccessToken(token);

    if (!payload) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
      });
    }

    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    await authService.logout(payload.userId, body?.refreshToken, ipAddress, userAgent);

    return { success: true };
  });

  // Logout from all devices
  fastify.post('/api/auth/logout-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
      });
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyAccessToken(token);

    if (!payload) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
      });
    }

    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    const count = await authService.logoutAll(payload.userId, ipAddress, userAgent);

    return {
      success: true,
      data: { sessionsRevoked: count },
    };
  });

  // Change password
  fastify.post('/api/auth/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
      });
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyAccessToken(token);

    if (!payload) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
      });
    }

    const body = changePasswordSchema.parse(request.body);
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    const result = await authService.changePassword(
      payload.userId,
      body.currentPassword,
      body.newPassword,
      ipAddress,
      userAgent
    );

    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'PASSWORD_CHANGE_FAILED', message: result.error },
      });
    }

    return { success: true };
  });

  // Get current user
  fastify.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
      });
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyAccessToken(token);

    if (!payload) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
      });
    }

    const user = await userRepository.findById(payload.userId);

    if (!user) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    // Remove sensitive data
    const { passwordHash, ...safeUser } = user;

    return {
      success: true,
      data: safeUser,
    };
  });

  // Get user sessions
  fastify.get('/api/auth/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
      });
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyAccessToken(token);

    if (!payload) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
      });
    }

    const sessions = await authService.getUserSessions(payload.userId);

    return {
      success: true,
      data: sessions,
    };
  });

  // Request password reset (placeholder)
  fastify.post('/api/auth/reset-password-request', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string };
    const email = body.email;

    if (!email) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Email is required' },
      });
    }

    // In production, this would send an email
    await authService.resetPasswordRequest(email);

    return {
      success: true,
      message: 'If the email exists, a reset link has been sent',
    };
  });
}
