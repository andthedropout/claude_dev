import type { ServerWebSocket } from 'bun';
import type { Subprocess } from 'bun';
import { db } from './db';
import { tickets } from './schema';
import { eq } from 'drizzle-orm';

// Terminal session that persists independently of WebSocket connections
interface TerminalSession {
  ticketId: string;
  process: Subprocess<'pipe', 'pipe', 'pipe'> | null;
  clients: Set<ServerWebSocket<unknown>>;
  // Buffer recent output for reconnecting clients
  outputBuffer: string[];
  maxBufferLines: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: Date | null;
  error?: string;
}

// Sessions persist in memory - they're the core of the app
const sessions = new Map<string, TerminalSession>();

export function getOrCreateTerminalSession(ticketId: string): TerminalSession {
  let session = sessions.get(ticketId);
  if (!session) {
    session = {
      ticketId,
      process: null,
      clients: new Set(),
      outputBuffer: [],
      maxBufferLines: 1000, // Keep last 1000 lines
      status: 'stopped',
      startedAt: null,
    };
    sessions.set(ticketId, session);
  }
  return session;
}

export function getTerminalSession(ticketId: string): TerminalSession | undefined {
  return sessions.get(ticketId);
}

// Add output to buffer (for reconnecting clients)
function bufferOutput(session: TerminalSession, data: string) {
  // Split into lines and add to buffer
  const lines = data.split('\n');
  session.outputBuffer.push(...lines);

  // Trim buffer if too large
  while (session.outputBuffer.length > session.maxBufferLines) {
    session.outputBuffer.shift();
  }
}

export async function startTerminalSession(ticketId: string): Promise<void> {
  const session = getOrCreateTerminalSession(ticketId);

  // If already running, just return
  if (session.process && session.status === 'running') {
    console.log(`Terminal session already running for ticket ${ticketId}`);
    return;
  }

  session.status = 'starting';

  // Look up ticket to get sessionId
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  const sessionId = ticket?.sessionId;

  console.log(`Starting terminal for ticket ${ticketId}${sessionId ? ` (resuming session ${sessionId})` : ''}`);

  // Build the command
  let innerCmd = 'claude';
  if (sessionId) {
    innerCmd = `claude --resume ${sessionId}`;
  }

  // Use Python pty module for proper PTY handling
  const pythonScript = `
import pty
import os
import sys
import select
import fcntl
import struct
import termios
import signal

os.environ['TERM'] = 'xterm-256color'
os.environ['COLORTERM'] = 'truecolor'
os.environ['COLUMNS'] = '120'
os.environ['LINES'] = '40'
os.environ['FORCE_COLOR'] = '3'

pid, fd = pty.fork()
if pid == 0:
    os.execlp('bash', 'bash', '-c', '''${innerCmd.replace(/'/g, "'\\''")}''')
else:
    # Set terminal size
    winsize = struct.pack('HHHH', 40, 120, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

    global child_exited
    child_exited = False

    def sigchld_handler(signum, frame):
        global child_exited
        child_exited = True
    signal.signal(signal.SIGCHLD, sigchld_handler)

    try:
        while True:
            # Check if child has exited
            try:
                wpid, status = os.waitpid(pid, os.WNOHANG)
                if wpid != 0:
                    child_exited = True
            except ChildProcessError:
                child_exited = True

            r, w, e = select.select([fd, sys.stdin], [], [], 0.1)
            if fd in r:
                try:
                    data = os.read(fd, 4096)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.flush()
                    elif child_exited:
                        # Only break if child has actually exited AND no data
                        break
                except OSError:
                    break
            elif child_exited:
                # Child exited and no data ready to read
                break
            if sys.stdin in r:
                try:
                    data = sys.stdin.buffer.read1(4096)
                    if data:
                        os.write(fd, data)
                except:
                    pass
    except KeyboardInterrupt:
        pass
    finally:
        os.close(fd)
`;

  const args = ['python3', '-u', '-c', pythonScript]; // -u for unbuffered

  console.log(`Spawning python pty for: ${innerCmd}`);

  const proc = Bun.spawn(args, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
      COLUMNS: '120',
      LINES: '40',
    },
  });

  session.process = proc;
  session.status = 'running';
  session.startedAt = new Date();

  // Stream stdout to clients AND buffer it
  if (proc.stdout) {
    (async () => {
      const reader = proc.stdout!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);

          // Buffer output for reconnecting clients
          bufferOutput(session, text);

          // Broadcast to all connected clients
          broadcastToSession(ticketId, text);
        }
      } catch (e) {
        console.error('stdout error:', e);
      }
    })();
  }

  // Stream stderr too (usually debug info)
  if (proc.stderr) {
    (async () => {
      const reader = proc.stderr!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          console.log('Terminal stderr:', text);
        }
      } catch (e) {
        console.error('stderr error:', e);
      }
    })();
  }

  // Handle process exit
  proc.exited.then((code) => {
    console.log(`Terminal exited with code ${code} for ${ticketId}`);
    session.process = null;
    session.status = 'stopped';

    const exitMessage = `\r\n\x1b[33m[Terminal session ended (code ${code})]\x1b[0m\r\n`;
    bufferOutput(session, exitMessage);
    broadcastToSession(ticketId, exitMessage);
  });
}

export function sendToTerminal(ticketId: string, data: string): void {
  const session = sessions.get(ticketId);
  if (session?.process?.stdin) {
    try {
      session.process.stdin.write(data);
      session.process.stdin.flush();
    } catch (e) {
      console.error('Error writing to terminal:', e);
    }
  } else {
    console.warn(`No terminal process for ticket ${ticketId}`);
  }
}

export function broadcastToSession(ticketId: string, data: string): void {
  const session = sessions.get(ticketId);
  if (session) {
    for (const client of session.clients) {
      try {
        client.send(data);
      } catch (e) {
        console.error('Error sending to client:', e);
        // Remove dead clients
        session.clients.delete(client);
      }
    }
  }
}

export function addClientToSession(ticketId: string, ws: ServerWebSocket<unknown>): void {
  const session = getOrCreateTerminalSession(ticketId);
  session.clients.add(ws);
  console.log(`Client connected to terminal ${ticketId}. Total clients: ${session.clients.size}`);

  // Send buffered output to the new client so they can see history
  if (session.outputBuffer.length > 0) {
    try {
      const history = session.outputBuffer.join('');
      ws.send(history);
    } catch (e) {
      console.error('Error sending buffer to client:', e);
    }
  }
}

export function removeClientFromSession(ticketId: string, ws: ServerWebSocket<unknown>): void {
  const session = sessions.get(ticketId);
  if (session) {
    session.clients.delete(ws);
    console.log(`Client disconnected from terminal ${ticketId}. Total clients: ${session.clients.size}`);
    // NOTE: We do NOT stop the session when clients disconnect
    // The session keeps running independently
  }
}

export function killTerminalSession(ticketId: string): void {
  const session = sessions.get(ticketId);
  if (session?.process) {
    console.log(`Killing terminal session for ${ticketId}`);
    session.process.kill();
    session.process = null;
    session.status = 'stopped';
  }
}

export function getSessionStatus(ticketId: string): {
  running: boolean;
  status: string;
  clients: number;
  startedAt: Date | null;
} {
  const session = sessions.get(ticketId);
  return {
    running: session?.process !== null && session?.status === 'running',
    status: session?.status || 'none',
    clients: session?.clients.size || 0,
    startedAt: session?.startedAt || null,
  };
}
