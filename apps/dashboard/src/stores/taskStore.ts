import { create } from 'zustand';
import type { Task } from '@cda/shared';
import { tasksApi } from '../services/api';

interface TaskState {
  tasks: Task[];
  selectedTask: Task | null;
  isLoading: boolean;
  error: string | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  filters: {
    status?: string;
    type?: string;
  };
  stats: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  } | null;
}

interface TaskActions {
  fetchTasks: () => Promise<void>;
  fetchTask: (id: string) => Promise<void>;
  createTask: (task: { title: string; description?: string; type?: string; priority?: number }) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  executeTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  setFilters: (filters: { status?: string; type?: string }) => void;
  setPage: (page: number) => void;
  selectTask: (task: Task | null) => void;
  updateTaskInList: (task: Task) => void;
  clearError: () => void;
}

export const useTaskStore = create<TaskState & TaskActions>((set, get) => ({
  tasks: [],
  selectedTask: null,
  isLoading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
  },
  filters: {},
  stats: null,

  fetchTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters, pagination } = get();
      const response = await tasksApi.list({
        ...filters,
        page: pagination.page,
        limit: pagination.limit,
      });
      set({
        tasks: response.data || [],
        pagination: {
          ...pagination,
          total: response.meta?.total || 0,
        },
        isLoading: false,
      });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  fetchTask: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await tasksApi.get(id);
      set({ selectedTask: response.data, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createTask: async (task) => {
    set({ isLoading: true, error: null });
    try {
      const response = await tasksApi.create(task);
      const newTask = response.data!;
      set((state) => ({
        tasks: [newTask, ...state.tasks],
        isLoading: false,
      }));
      return newTask;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  updateTask: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      const response = await tasksApi.update(id, updates);
      const updatedTask = response.data!;
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updatedTask : t)),
        selectedTask: state.selectedTask?.id === id ? updatedTask : state.selectedTask,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  deleteTask: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await tasksApi.delete(id);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
        selectedTask: state.selectedTask?.id === id ? null : state.selectedTask,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  executeTask: async (id) => {
    set({ error: null });
    try {
      const response = await tasksApi.execute(id);
      const updatedTask = response.data!;
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updatedTask : t)),
        selectedTask: state.selectedTask?.id === id ? updatedTask : state.selectedTask,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  cancelTask: async (id) => {
    set({ error: null });
    try {
      const response = await tasksApi.cancel(id);
      const updatedTask = response.data!;
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updatedTask : t)),
        selectedTask: state.selectedTask?.id === id ? updatedTask : state.selectedTask,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  fetchStats: async () => {
    try {
      const response = await tasksApi.stats();
      set({ stats: response.data });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  },

  setFilters: (filters) => {
    set({ filters, pagination: { ...get().pagination, page: 1 } });
    get().fetchTasks();
  },

  setPage: (page) => {
    set({ pagination: { ...get().pagination, page } });
    get().fetchTasks();
  },

  selectTask: (task) => {
    set({ selectedTask: task });
  },

  updateTaskInList: (task) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
      selectedTask: state.selectedTask?.id === task.id ? task : state.selectedTask,
    }));
  },

  clearError: () => {
    set({ error: null });
  },
}));
