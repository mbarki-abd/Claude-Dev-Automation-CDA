import { create } from 'zustand';
import type { Proposal } from '@cda/shared';
import { proposalsApi } from '../services/api';

interface ProposalState {
  proposals: Proposal[];
  pendingProposals: Proposal[];
  selectedProposal: Proposal | null;
  isLoading: boolean;
  error: string | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  filters: {
    status?: string;
    taskId?: string;
  };
}

interface ProposalActions {
  fetchProposals: () => Promise<void>;
  fetchPendingProposals: () => Promise<void>;
  fetchProposal: (id: string) => Promise<void>;
  approveProposal: (id: string, optionId: string) => Promise<void>;
  rejectProposal: (id: string) => Promise<void>;
  setFilters: (filters: { status?: string; taskId?: string }) => void;
  setPage: (page: number) => void;
  selectProposal: (proposal: Proposal | null) => void;
  clearError: () => void;
}

export const useProposalStore = create<ProposalState & ProposalActions>((set, get) => ({
  proposals: [],
  pendingProposals: [],
  selectedProposal: null,
  isLoading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
  },
  filters: {},

  fetchProposals: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters, pagination } = get();
      const response = await proposalsApi.list({
        ...filters,
        page: pagination.page,
        limit: pagination.limit,
      });
      set({
        proposals: response.data || [],
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

  fetchPendingProposals: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await proposalsApi.pending();
      set({
        pendingProposals: response.data || [],
        isLoading: false,
      });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  fetchProposal: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await proposalsApi.get(id);
      set({ selectedProposal: response.data, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  approveProposal: async (id: string, optionId: string) => {
    set({ error: null });
    try {
      const response = await proposalsApi.approve(id, optionId);
      const updatedProposal = response.data!;
      set((state) => ({
        proposals: state.proposals.map((p) => (p.id === id ? updatedProposal : p)),
        pendingProposals: state.pendingProposals.filter((p) => p.id !== id),
        selectedProposal: state.selectedProposal?.id === id ? updatedProposal : state.selectedProposal,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  rejectProposal: async (id: string) => {
    set({ error: null });
    try {
      const response = await proposalsApi.reject(id);
      const updatedProposal = response.data!;
      set((state) => ({
        proposals: state.proposals.map((p) => (p.id === id ? updatedProposal : p)),
        pendingProposals: state.pendingProposals.filter((p) => p.id !== id),
        selectedProposal: state.selectedProposal?.id === id ? updatedProposal : state.selectedProposal,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  setFilters: (filters) => {
    set({ filters, pagination: { ...get().pagination, page: 1 } });
    get().fetchProposals();
  },

  setPage: (page) => {
    set({ pagination: { ...get().pagination, page } });
    get().fetchProposals();
  },

  selectProposal: (proposal) => {
    set({ selectedProposal: proposal });
  },

  clearError: () => {
    set({ error: null });
  },
}));
