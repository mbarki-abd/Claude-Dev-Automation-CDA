import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { userRepository, User, CreateUserInput } from '../database/repositories/UserRepository.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('auth-service');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

export interface TokenPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResult {
  success: boolean;
  user?: Omit<User, 'passwordHash'>;
  tokens?: AuthTokens;
  error?: string;
}

export interface SignupResult {
  success: boolean;
  user?: Omit<User, 'passwordHash'>;
  tokens?: AuthTokens;
  error?: string;
}

class AuthService {
  private removePasswordHash(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async signup(input: CreateUserInput, ipAddress?: string, userAgent?: string): Promise<SignupResult> {
    try {
      // Check if email already exists
      const existingEmail = await userRepository.findByEmail(input.email);
      if (existingEmail) {
        return { success: false, error: 'Email already registered' };
      }

      // Check if username already exists
      const existingUsername = await userRepository.findByUsername(input.username);
      if (existingUsername) {
        return { success: false, error: 'Username already taken' };
      }

      // Create user
      const user = await userRepository.create(input);

      // Generate tokens
      const tokens = await this.generateTokens(user, ipAddress, userAgent);

      // Log audit
      await userRepository.logAudit(user.id, 'signup', 'user', user.id, { email: user.email }, ipAddress, userAgent);

      logger.info({ userId: user.id, email: user.email }, 'User signed up');

      return {
        success: true,
        user: this.removePasswordHash(user),
        tokens,
      };
    } catch (error) {
      logger.error({ error, email: input.email }, 'Signup failed');
      return { success: false, error: 'Signup failed' };
    }
  }

  async login(emailOrUsername: string, password: string, ipAddress?: string, userAgent?: string): Promise<LoginResult> {
    try {
      // Find user by email or username
      let user = await userRepository.findByEmail(emailOrUsername);
      if (!user) {
        user = await userRepository.findByUsername(emailOrUsername);
      }

      if (!user) {
        await userRepository.logAudit(null, 'login_failed', 'auth', null, { emailOrUsername, reason: 'user_not_found' }, ipAddress, userAgent);
        return { success: false, error: 'Invalid credentials' };
      }

      // Check user status
      if (user.status !== 'active') {
        await userRepository.logAudit(user.id, 'login_failed', 'auth', null, { reason: 'account_inactive', status: user.status }, ipAddress, userAgent);
        return { success: false, error: `Account is ${user.status}` };
      }

      // Verify password
      const isValid = await userRepository.verifyPassword(user, password);
      if (!isValid) {
        await userRepository.logAudit(user.id, 'login_failed', 'auth', null, { reason: 'invalid_password' }, ipAddress, userAgent);
        return { success: false, error: 'Invalid credentials' };
      }

      // Record login
      await userRepository.recordLogin(user.id, ipAddress);

      // Generate tokens
      const tokens = await this.generateTokens(user, ipAddress, userAgent);

      // Log audit
      await userRepository.logAudit(user.id, 'login', 'auth', null, { method: 'password' }, ipAddress, userAgent);

      logger.info({ userId: user.id, email: user.email }, 'User logged in');

      return {
        success: true,
        user: this.removePasswordHash(user),
        tokens,
      };
    } catch (error) {
      logger.error({ error, emailOrUsername }, 'Login failed');
      return { success: false, error: 'Login failed' };
    }
  }

  async refreshTokens(refreshToken: string, ipAddress?: string, userAgent?: string): Promise<AuthTokens | null> {
    try {
      // Verify refresh token
      const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as TokenPayload & { sessionId: string };

      // Find valid session
      const session = await userRepository.findValidSession(payload.userId, refreshToken);
      if (!session) {
        logger.warn({ userId: payload.userId }, 'Invalid refresh token or session');
        return null;
      }

      // Get user
      const user = await userRepository.findById(payload.userId);
      if (!user || user.status !== 'active') {
        return null;
      }

      // Revoke old session
      await userRepository.revokeSession(session.id);

      // Generate new tokens
      const tokens = await this.generateTokens(user, ipAddress, userAgent);

      logger.debug({ userId: user.id }, 'Tokens refreshed');

      return tokens;
    } catch (error) {
      logger.error({ error }, 'Token refresh failed');
      return null;
    }
  }

  async logout(userId: string, refreshToken?: string, ipAddress?: string, userAgent?: string): Promise<boolean> {
    try {
      if (refreshToken) {
        // Revoke specific session
        const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as TokenPayload & { sessionId: string };
        const session = await userRepository.findValidSession(payload.userId, refreshToken);
        if (session) {
          await userRepository.revokeSession(session.id);
        }
      } else {
        // Revoke all sessions
        await userRepository.revokeAllUserSessions(userId);
      }

      await userRepository.logAudit(userId, 'logout', 'auth', null, {}, ipAddress, userAgent);

      logger.info({ userId }, 'User logged out');

      return true;
    } catch (error) {
      logger.error({ error, userId }, 'Logout failed');
      return false;
    }
  }

  async logoutAll(userId: string, ipAddress?: string, userAgent?: string): Promise<number> {
    try {
      const count = await userRepository.revokeAllUserSessions(userId);

      await userRepository.logAudit(userId, 'logout_all', 'auth', null, { sessionsRevoked: count }, ipAddress, userAgent);

      logger.info({ userId, sessionsRevoked: count }, 'All sessions revoked');

      return count;
    } catch (error) {
      logger.error({ error, userId }, 'Logout all failed');
      return 0;
    }
  }

  verifyAccessToken(token: string): TokenPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
      return payload;
    } catch (error) {
      return null;
    }
  }

  private async generateTokens(user: User, ipAddress?: string, userAgent?: string): Promise<AuthTokens> {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    // Generate access token
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

    // Generate refresh token with session ID
    const refreshToken = jwt.sign(
      { ...payload, sessionId: crypto.randomUUID() },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // Calculate expiry
    const expiresIn = this.parseExpiry(ACCESS_TOKEN_EXPIRY);
    const refreshExpiresAt = new Date(Date.now() + this.parseExpiry(REFRESH_TOKEN_EXPIRY) * 1000);

    // Store session
    await userRepository.createSession(
      user.id,
      refreshToken,
      refreshExpiresAt,
      { source: 'web' },
      ipAddress,
      userAgent
    );

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      default:
        return 900;
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Verify current password
      const isValid = await userRepository.verifyPassword(user, currentPassword);
      if (!isValid) {
        await userRepository.logAudit(userId, 'password_change_failed', 'auth', null, { reason: 'invalid_current_password' }, ipAddress, userAgent);
        return { success: false, error: 'Current password is incorrect' };
      }

      // Update password
      await userRepository.updatePassword(userId, newPassword);

      // Revoke all sessions
      await userRepository.revokeAllUserSessions(userId);

      await userRepository.logAudit(userId, 'password_changed', 'auth', null, {}, ipAddress, userAgent);

      logger.info({ userId }, 'Password changed');

      return { success: true };
    } catch (error) {
      logger.error({ error, userId }, 'Password change failed');
      return { success: false, error: 'Password change failed' };
    }
  }

  async resetPasswordRequest(email: string): Promise<{ success: boolean; resetToken?: string }> {
    try {
      const user = await userRepository.findByEmail(email);
      if (!user) {
        // Don't reveal if email exists
        return { success: true };
      }

      // Generate reset token (in production, send via email)
      const resetToken = crypto.randomBytes(32).toString('hex');

      // Store reset token (in production, store hashed and with expiry)
      // For now, return it directly (for testing)

      logger.info({ userId: user.id }, 'Password reset requested');

      return { success: true, resetToken };
    } catch (error) {
      logger.error({ error, email }, 'Password reset request failed');
      return { success: false };
    }
  }

  async getUserSessions(userId: string): Promise<Array<{
    id: string;
    deviceInfo?: Record<string, unknown>;
    ipAddress?: string;
    createdAt: Date;
    current: boolean;
  }>> {
    const sessions = await userRepository.getUserSessions(userId);
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      current: false, // Would need current token to determine
    }));
  }
}

export const authService = new AuthService();
