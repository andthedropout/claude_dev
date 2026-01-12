// Use relative URL in production (served from same origin), absolute in development
const API_URL = import.meta.env.DEV ? 'http://localhost:4000/api' : '/api';

export interface Column {
  id: string;
  name: string;
  position: number;
  triggersAgent: boolean;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  columnId: string;
  position: number;
  priority: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PRD {
  id: string;
  ticketId: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  ticketId: string;
  senderType: 'human' | 'agent' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface TicketWithDetails extends Ticket {
  prd?: PRD;
  messages?: Message[];
}

// Columns
export async function getColumns(): Promise<Column[]> {
  const res = await fetch(`${API_URL}/columns`);
  return res.json();
}

// Tickets
export async function getTickets(): Promise<Ticket[]> {
  const res = await fetch(`${API_URL}/tickets`);
  return res.json();
}

export async function getTicket(id: string): Promise<TicketWithDetails> {
  const res = await fetch(`${API_URL}/tickets/${id}`);
  return res.json();
}

export async function createTicket(data: { title: string; description?: string; columnId?: string }): Promise<TicketWithDetails> {
  const res = await fetch(`${API_URL}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateTicket(id: string, data: Partial<Ticket>): Promise<Ticket> {
  const res = await fetch(`${API_URL}/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function moveTicket(id: string, columnId: string, position: number): Promise<Ticket> {
  const res = await fetch(`${API_URL}/tickets/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, position }),
  });
  return res.json();
}

export async function deleteTicket(id: string): Promise<void> {
  await fetch(`${API_URL}/tickets/${id}`, { method: 'DELETE' });
}

// PRD
export async function updatePRD(ticketId: string, content: string): Promise<PRD> {
  const res = await fetch(`${API_URL}/tickets/${ticketId}/prd`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return res.json();
}

// Messages
export async function getMessages(ticketId: string): Promise<Message[]> {
  const res = await fetch(`${API_URL}/tickets/${ticketId}/messages`);
  return res.json();
}

export async function addMessage(ticketId: string, content: string, senderType: string = 'human'): Promise<Message> {
  const res = await fetch(`${API_URL}/tickets/${ticketId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, senderType }),
  });
  return res.json();
}

// Chat with Claude
export interface ChatResponse {
  userMessage: Message;
  assistantMessage: Message;
  terminalOutput?: string;
}

export async function sendChatMessage(ticketId: string, content: string): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat/${ticketId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error('Failed to send message');
  }
  return res.json();
}

// Agents
export interface Agent {
  id: string;
  ticketId: string;
  status: string;
  worktreePath?: string;
  sessionId?: string;
  iterationCount: number;
  maxIterations: number;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  createdAt: string;
}

export interface AgentStatus {
  queue: string[];
  currentJob: {
    ticketId: string;
    agentId: string;
    status: string;
    iterations: number;
  } | null;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const res = await fetch(`${API_URL}/agents/status`);
  return res.json();
}

export async function startAgent(ticketId: string): Promise<{ message: string; ticketId: string }> {
  const res = await fetch(`${API_URL}/agents/start/${ticketId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to start agent');
  }
  return res.json();
}

export async function resumeAgent(ticketId: string, response: string): Promise<{ message: string; ticketId: string }> {
  const res = await fetch(`${API_URL}/agents/resume/${ticketId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
  });
  if (!res.ok) {
    throw new Error('Failed to resume agent');
  }
  return res.json();
}

export async function killAgent(ticketId: string): Promise<{ message: string; ticketId: string }> {
  const res = await fetch(`${API_URL}/agents/kill/${ticketId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to kill agent');
  }
  return res.json();
}

// Terminal
export async function startTerminal(ticketId: string): Promise<{ message: string; ticketId: string; status: { running: boolean; status: string } }> {
  const res = await fetch(`${API_URL}/agents/terminal/start/${ticketId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to start terminal');
  }
  return res.json();
}

export async function getTerminalStatus(ticketId: string): Promise<{ running: boolean; status: string; clients: number }> {
  const res = await fetch(`${API_URL}/agents/terminal/status/${ticketId}`);
  return res.json();
}
