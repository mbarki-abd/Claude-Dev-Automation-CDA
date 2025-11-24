import type { Task, Execution, Proposal, ApiResponse, PaginatedResponse, SystemLog } from '@cda/shared';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.error?.message || error.message || 'API request failed');
  }

  return response.json();
}

// Tasks API
export const tasksApi = {
  list: async (params?: { status?: string; type?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return fetchApi<PaginatedResponse<Task>>(`/api/tasks${query ? `?${query}` : ''}`);
  },

  get: async (id: string) => {
    return fetchApi<ApiResponse<Task>>(`/api/tasks/${id}`);
  },

  create: async (task: {
    title: string;
    description?: string;
    type?: string;
    priority?: number;
  }) => {
    return fetchApi<ApiResponse<Task>>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  },

  update: async (id: string, updates: Partial<Task>) => {
    return fetchApi<ApiResponse<Task>>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  delete: async (id: string) => {
    return fetchApi<ApiResponse<{ deleted: boolean }>>(`/api/tasks/${id}`, {
      method: 'DELETE',
    });
  },

  execute: async (id: string) => {
    return fetchApi<ApiResponse<Task>>(`/api/tasks/${id}/execute`, {
      method: 'POST',
    });
  },

  cancel: async (id: string) => {
    return fetchApi<ApiResponse<Task>>(`/api/tasks/${id}/cancel`, {
      method: 'POST',
    });
  },

  stats: async () => {
    return fetchApi<ApiResponse<{
      total: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
    }>>('/api/tasks/stats');
  },
};

// Executions API
export const executionsApi = {
  list: async (params?: { taskId?: string; status?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.taskId) searchParams.set('taskId', params.taskId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return fetchApi<PaginatedResponse<Execution>>(`/api/executions${query ? `?${query}` : ''}`);
  },

  get: async (id: string) => {
    return fetchApi<ApiResponse<Execution>>(`/api/executions/${id}`);
  },

  logs: async (id: string, params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return fetchApi<ApiResponse<Array<{
      id: string;
      timestamp: string;
      stream: string;
      data: string;
    }>>>(`/api/executions/${id}/logs${query ? `?${query}` : ''}`);
  },

  cancel: async (id: string) => {
    return fetchApi<ApiResponse<Execution>>(`/api/executions/${id}/cancel`, {
      method: 'POST',
    });
  },
};

// Proposals API
export const proposalsApi = {
  list: async (params?: { taskId?: string; status?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.taskId) searchParams.set('taskId', params.taskId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return fetchApi<PaginatedResponse<Proposal>>(`/api/proposals${query ? `?${query}` : ''}`);
  },

  pending: async () => {
    return fetchApi<ApiResponse<Proposal[]>>('/api/proposals/pending');
  },

  get: async (id: string) => {
    return fetchApi<ApiResponse<Proposal>>(`/api/proposals/${id}`);
  },

  approve: async (id: string, optionId: string) => {
    return fetchApi<ApiResponse<Proposal>>(`/api/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    });
  },

  reject: async (id: string) => {
    return fetchApi<ApiResponse<Proposal>>(`/api/proposals/${id}/reject`, {
      method: 'POST',
    });
  },
};

// Health API
export const healthApi = {
  check: async () => {
    return fetchApi<{
      status: string;
      timestamp: string;
      version: string;
      uptime: number;
      checks: Record<string, { status: string; latency?: number }>;
    }>('/api/health');
  },
};

// System Logs API
export const systemLogsApi = {
  list: async (params?: { category?: string; level?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set('category', params.category);
    if (params?.level) searchParams.set('level', params.level);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return fetchApi<PaginatedResponse<SystemLog>>(`/api/system-logs${query ? `?${query}` : ''}`);
  },

  get: async (id: string) => {
    return fetchApi<ApiResponse<SystemLog>>(`/api/system-logs/${id}`);
  },
};

// Terminal API (Docker container console)
export const terminalApi = {
  execute: async (command: string, workDir?: string) => {
    return fetchApi<ApiResponse<{ output: string; exitCode: number }>>('/api/terminal/execute', {
      method: 'POST',
      body: JSON.stringify({ command, workDir }),
    });
  },

  listFiles: async (path: string) => {
    return fetchApi<ApiResponse<{ files: Array<{ name: string; type: 'file' | 'directory'; size?: number }> }>>('/api/terminal/files', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  claudeCode: async (prompt: string, workDir?: string) => {
    return fetchApi<ApiResponse<{ output: string; exitCode: number }>>('/api/terminal/claude-code', {
      method: 'POST',
      body: JSON.stringify({ prompt, workDir }),
    });
  },
};
