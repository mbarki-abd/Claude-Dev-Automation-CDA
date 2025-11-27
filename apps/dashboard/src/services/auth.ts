const API_URL = import.meta.env.VITE_API_URL || '';

export interface User {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  role: 'admin' | 'user' | 'viewer';
  status: 'active' | 'inactive' | 'suspended';
  unixUsername?: string;
  unixUid?: number;
  homeDirectory?: string;
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export interface LoginCredentials {
  emailOrUsername: string;
  password: string;
}

export interface SignupData {
  email: string;
  username: string;
  password: string;
  fullName?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface Session {
  id: string;
  deviceInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  expiresAt: string;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('accessToken');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${url}`, {
    ...options,
    headers,
  });

  // Handle 401 by attempting token refresh
  if (response.status === 401 && localStorage.getItem('refreshToken')) {
    const refreshed = await authService.refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${localStorage.getItem('accessToken')}`;
      return fetch(`${API_URL}${url}`, {
        ...options,
        headers,
      });
    }
  }

  return response;
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Login failed');
    }

    return data.data;
  },

  async signup(signupData: SignupData): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Signup failed');
    }

    return data.data;
  },

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return;

    await fetchWithAuth('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  async logoutAll(): Promise<void> {
    await fetchWithAuth('/api/auth/logout-all', {
      method: 'POST',
    });
  },

  async refreshToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      localStorage.setItem('accessToken', data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      return true;
    } catch {
      return false;
    }
  },

  async getMe(): Promise<User> {
    const response = await fetchWithAuth('/api/auth/me');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get user');
    }

    return data.data;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await fetchWithAuth('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to change password');
    }
  },

  async getSessions(): Promise<Session[]> {
    const response = await fetchWithAuth('/api/auth/sessions');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get sessions');
    }

    return data.data;
  },
};

export { fetchWithAuth };
