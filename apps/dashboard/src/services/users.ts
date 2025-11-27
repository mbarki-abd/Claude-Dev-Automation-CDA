import { fetchWithAuth, User } from './auth';

export interface CreateUserData {
  email: string;
  username: string;
  password: string;
  fullName?: string;
  role?: 'admin' | 'user' | 'viewer';
}

export interface UpdateUserData {
  email?: string;
  username?: string;
  fullName?: string;
  role?: 'admin' | 'user' | 'viewer';
  status?: 'active' | 'inactive' | 'suspended';
  timezone?: string;
  locale?: string;
}

export interface UserCredential {
  id: string;
  provider: string;
  credentialType: string;
  status: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface ClaudeAuthStatus {
  id?: string;
  authMethod?: string;
  status: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface UnixAccountResult {
  unixUsername: string;
  unixUid: number;
  unixGid: number;
  homeDirectory: string;
}

export const userService = {
  async getAll(): Promise<User[]> {
    const response = await fetchWithAuth('/api/users');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to fetch users');
    }
    return data.data;
  },

  async getById(id: string): Promise<User> {
    const response = await fetchWithAuth(`/api/users/${id}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to fetch user');
    }
    return data.data;
  },

  async create(userData: CreateUserData): Promise<User> {
    const response = await fetchWithAuth('/api/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create user');
    }
    return data.data;
  },

  async update(id: string, userData: UpdateUserData): Promise<User> {
    const response = await fetchWithAuth(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to update user');
    }
    return data.data;
  },

  async delete(id: string): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to delete user');
    }
  },

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to reset password');
    }
  },

  // Unix Account Management
  async createUnixAccount(id: string, preferredUsername?: string): Promise<UnixAccountResult> {
    const response = await fetchWithAuth(`/api/users/${id}/unix-account`, {
      method: 'POST',
      body: JSON.stringify({ preferredUsername }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create Unix account');
    }
    return data.data;
  },

  async getUnixAccount(id: string): Promise<UnixAccountResult | null> {
    const response = await fetchWithAuth(`/api/users/${id}/unix-account`);
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(data.error?.message || 'Failed to get Unix account');
    }
    return data.data;
  },

  async deleteUnixAccount(id: string): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}/unix-account`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to delete Unix account');
    }
  },

  // Credentials Management
  async getCredentials(id: string): Promise<UserCredential[]> {
    const response = await fetchWithAuth(`/api/users/${id}/credentials`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to fetch credentials');
    }
    return data.data;
  },

  async addCredential(id: string, provider: string, credentialType: string, credentials: Record<string, unknown>): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}/credentials`, {
      method: 'POST',
      body: JSON.stringify({ provider, credentialType, credentials }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to add credential');
    }
  },

  async deleteCredential(userId: string, credentialId: string): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${userId}/credentials/${credentialId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to delete credential');
    }
  },

  // Claude Auth Management
  async getClaudeAuth(id: string): Promise<ClaudeAuthStatus> {
    const response = await fetchWithAuth(`/api/users/${id}/claude-auth`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get Claude auth status');
    }
    return data.data;
  },

  async setClaudeApiKey(id: string, apiKey: string): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}/claude-auth/api-key`, {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to set Claude API key');
    }
  },

  async setClaudeOAuthTokens(id: string, tokens: { accessToken: string; refreshToken?: string; expiresAt?: string }): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}/claude-auth/oauth`, {
      method: 'POST',
      body: JSON.stringify(tokens),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to set Claude OAuth tokens');
    }
  },

  async revokeClaudeAuth(id: string): Promise<void> {
    const response = await fetchWithAuth(`/api/users/${id}/claude-auth`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Failed to revoke Claude auth');
    }
  },
};
