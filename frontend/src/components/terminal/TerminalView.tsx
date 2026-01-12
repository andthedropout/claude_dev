import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  ticketId: string;
  sessionId?: string;
}

export function TerminalView({ ticketId, sessionId }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
      theme: {
        background: '#0d0d0d',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: '#5e6ad250',
        black: '#000000',
        red: '#e5484d',
        green: '#30a46c',
        yellow: '#f5a623',
        blue: '#0091ff',
        magenta: '#ab6eff',
        cyan: '#00c2d7',
        white: '#e0e0e0',
        brightBlack: '#6b6b6f',
        brightRed: '#ff6b6b',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Welcome message
    term.writeln('\x1b[1;35m╭──────────────────────────────────────╮\x1b[0m');
    term.writeln('\x1b[1;35m│\x1b[0m  \x1b[1;36mClaude Code Terminal\x1b[0m               \x1b[1;35m│\x1b[0m');
    term.writeln('\x1b[1;35m╰──────────────────────────────────────╯\x1b[0m');
    term.writeln('');

    // Always connect to terminal - it will auto-start if needed
    term.writeln('\x1b[90mConnecting to terminal...\x1b[0m');

    // Connect to WebSocket for terminal streaming
    const wsUrl = import.meta.env.DEV
      ? `ws://localhost:4000/ws/terminal/${ticketId}`
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal/${ticketId}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      term.writeln('\x1b[32mConnected!\x1b[0m');
      term.writeln('');
      // Send initial terminal size
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    ws.onmessage = (event) => {
      // Write terminal data
      term.write(event.data);
    };

    ws.onclose = () => {
      term.writeln('');
      term.writeln('\x1b[33mTerminal disconnected.\x1b[0m');
    };

    ws.onerror = () => {
      term.writeln('\x1b[31mConnection error.\x1b[0m');
    };

    wsRef.current = ws;

    // Handle user input - send to backend
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle terminal resize - send new dimensions to backend
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      wsRef.current?.close();
      term.dispose();
    };
  }, [ticketId, sessionId]);

  // Re-fit when container size changes
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });

    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#0d0d0d]"
      style={{ padding: '8px' }}
    />
  );
}
