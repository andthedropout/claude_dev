import { useEffect, useRef, useCallback } from 'react';

type WebSocketMessage = {
  type: string;
  payload?: unknown;
};

type WebSocketHandler = (message: WebSocketMessage) => void;

// Use relative URL in production (served from same origin), absolute in development
const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:4000/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

export function useWebSocket(onMessage: WebSocketHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subscribedTicketsRef = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Resubscribe to tickets on reconnect
      for (const ticketId of subscribedTicketsRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', ticketId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessage(message);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [onMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((ticketId: string) => {
    subscribedTicketsRef.current.add(ticketId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', ticketId }));
    }
  }, []);

  const unsubscribe = useCallback((ticketId: string) => {
    subscribedTicketsRef.current.delete(ticketId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', ticketId }));
    }
  }, []);

  return { subscribe, unsubscribe };
}
