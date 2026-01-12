import type { ServerWebSocket } from 'bun';

export type WebSocketData = {
  clientId: string;
  subscribedTickets: Set<string>;
};

// Store all connected clients
const clients = new Map<string, ServerWebSocket<WebSocketData>>();

// Broadcast event to all connected clients
export function broadcast(event: { type: string; payload: unknown }) {
  const message = JSON.stringify(event);
  for (const ws of clients.values()) {
    ws.send(message);
  }
}

// Broadcast to clients subscribed to a specific ticket
export function broadcastToTicket(ticketId: string, event: { type: string; payload: unknown }) {
  const message = JSON.stringify(event);
  for (const ws of clients.values()) {
    if (ws.data.subscribedTickets.has(ticketId)) {
      ws.send(message);
    }
  }
}

// WebSocket handlers
export const websocketHandlers = {
  open(ws: ServerWebSocket<WebSocketData>) {
    clients.set(ws.data.clientId, ws);
    console.log(`WebSocket connected: ${ws.data.clientId}`);
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'subscribe':
          // Subscribe to a ticket's updates
          if (data.ticketId) {
            ws.data.subscribedTickets.add(data.ticketId);
          }
          break;

        case 'unsubscribe':
          // Unsubscribe from a ticket
          if (data.ticketId) {
            ws.data.subscribedTickets.delete(data.ticketId);
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    clients.delete(ws.data.clientId);
    console.log(`WebSocket disconnected: ${ws.data.clientId}`);
  },
};

// Helper to generate client IDs
let clientIdCounter = 0;
export function generateClientId(): string {
  return `client-${Date.now()}-${++clientIdCounter}`;
}
