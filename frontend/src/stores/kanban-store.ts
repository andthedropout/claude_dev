import { create } from 'zustand';
import type { Column, Ticket, TicketWithDetails, Message } from '@/lib/api';
import * as api from '@/lib/api';

interface KanbanState {
  columns: Column[];
  tickets: Ticket[];
  selectedTicket: TicketWithDetails | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchColumns: () => Promise<void>;
  fetchTickets: () => Promise<void>;
  selectTicket: (id: string | null) => Promise<void>;
  createTicket: (title: string, columnId?: string) => Promise<Ticket>;
  updateTicket: (id: string, data: Partial<Ticket>) => Promise<void>;
  moveTicket: (id: string, columnId: string, position: number) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  updatePRD: (ticketId: string, content: string) => Promise<void>;
  addMessage: (ticketId: string, content: string) => Promise<{ userMessage: Message; terminalOutput?: string }>;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  columns: [],
  tickets: [],
  selectedTicket: null,
  isLoading: false,
  error: null,

  fetchColumns: async () => {
    try {
      const columns = await api.getColumns();
      set({ columns });
    } catch (e) {
      set({ error: 'Failed to fetch columns' });
    }
  },

  fetchTickets: async () => {
    try {
      set({ isLoading: true });
      const tickets = await api.getTickets();
      set({ tickets, isLoading: false });
    } catch (e) {
      set({ error: 'Failed to fetch tickets', isLoading: false });
    }
  },

  selectTicket: async (id: string | null) => {
    if (!id) {
      set({ selectedTicket: null });
      return;
    }
    try {
      const ticket = await api.getTicket(id);
      set({ selectedTicket: ticket });
    } catch (e) {
      set({ error: 'Failed to fetch ticket details' });
    }
  },

  createTicket: async (title: string, columnId?: string) => {
    try {
      const ticket = await api.createTicket({ title, columnId });
      set((state) => ({ tickets: [...state.tickets, ticket] }));
      return ticket;
    } catch (e) {
      set({ error: 'Failed to create ticket' });
      throw e;
    }
  },

  updateTicket: async (id: string, data: Partial<Ticket>) => {
    try {
      const updated = await api.updateTicket(id, data);
      set((state) => ({
        tickets: state.tickets.map((t) => (t.id === id ? updated : t)),
        selectedTicket: state.selectedTicket?.id === id
          ? { ...state.selectedTicket, ...updated }
          : state.selectedTicket,
      }));
    } catch (e) {
      set({ error: 'Failed to update ticket' });
    }
  },

  moveTicket: async (id: string, columnId: string, position: number) => {
    // Optimistic update
    set((state) => ({
      tickets: state.tickets.map((t) =>
        t.id === id ? { ...t, columnId, position } : t
      ),
    }));

    try {
      await api.moveTicket(id, columnId, position);

      // Auto-start agent when moving to in-progress
      if (columnId === 'in-progress') {
        await api.startAgent(id);
      }
    } catch (e) {
      // Revert on error
      get().fetchTickets();
      set({ error: 'Failed to move ticket' });
    }
  },

  deleteTicket: async (id: string) => {
    try {
      await api.deleteTicket(id);
      set((state) => ({
        tickets: state.tickets.filter((t) => t.id !== id),
        selectedTicket: state.selectedTicket?.id === id ? null : state.selectedTicket,
      }));
    } catch (e) {
      set({ error: 'Failed to delete ticket' });
    }
  },

  updatePRD: async (ticketId: string, content: string) => {
    try {
      const prd = await api.updatePRD(ticketId, content);
      set((state) => ({
        selectedTicket: state.selectedTicket?.id === ticketId
          ? { ...state.selectedTicket, prd }
          : state.selectedTicket,
      }));
    } catch (e) {
      set({ error: 'Failed to update PRD' });
    }
  },

  addMessage: async (ticketId: string, content: string) => {
    try {
      // Optimistically add user message first
      const tempUserMessage: Message = {
        id: 'temp-' + Date.now(),
        ticketId,
        content,
        senderType: 'human',
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        selectedTicket: state.selectedTicket?.id === ticketId
          ? {
              ...state.selectedTicket,
              messages: [...(state.selectedTicket.messages || []), tempUserMessage],
            }
          : state.selectedTicket,
      }));

      // Call chat API which returns both user and assistant messages
      const response = await api.sendChatMessage(ticketId, content);

      // Update with real messages (replace temp message with actual ones)
      set((state) => ({
        selectedTicket: state.selectedTicket?.id === ticketId
          ? {
              ...state.selectedTicket,
              messages: [
                ...(state.selectedTicket.messages || []).filter((m) => !m.id.startsWith('temp-')),
                { ...response.userMessage, createdAt: response.userMessage.createdAt || new Date().toISOString() },
                { ...response.assistantMessage, createdAt: response.assistantMessage.createdAt || new Date().toISOString() },
              ],
            }
          : state.selectedTicket,
      }));

      return { userMessage: response.userMessage, terminalOutput: response.terminalOutput };
    } catch (e) {
      // Remove temp message on error
      set((state) => ({
        selectedTicket: state.selectedTicket?.id === ticketId
          ? {
              ...state.selectedTicket,
              messages: (state.selectedTicket.messages || []).filter((m) => !m.id.startsWith('temp-')),
            }
          : state.selectedTicket,
        error: 'Failed to add message',
      }));
      throw e;
    }
  },
}));
