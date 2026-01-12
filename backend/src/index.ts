import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { initializeDatabase } from './lib/db';
import ticketsRouter from './routes/tickets';
import columnsRouter from './routes/columns';
import { chatRouter } from './routes/chat';
import { agentsRouter } from './routes/agents';
import { websocketHandlers, generateClientId, type WebSocketData } from './lib/websocket';
import { addClientToSession, removeClientFromSession, sendToTerminal, startTerminalSession } from './lib/terminal';
import { initWorktreeManager } from './lib/worktree';
import { initOrchestrator } from './lib/orchestrator';

const app = new Hono();

const isProduction = process.env.NODE_ENV === 'production';

// Middleware
app.use('*', logger());

// CORS - more permissive in development
if (isProduction) {
  // In production, frontend is served from same origin
  app.use('*', cors());
} else {
  app.use('*', cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
    credentials: true,
  }));
}

// Health check endpoint
app.get('/health', (c) => c.json({
  status: 'ok',
  message: 'Kanban PRD API',
  version: '1.0.0',
}));

// API routes
app.route('/api/tickets', ticketsRouter);
app.route('/api/columns', columnsRouter);
app.route('/api/chat', chatRouter);
app.route('/api/agents', agentsRouter);

// In production, serve static frontend files
const frontendDistPath = resolve(__dirname, '../../frontend/dist');

if (isProduction && existsSync(frontendDistPath)) {
  console.log(`Serving static files from ${frontendDistPath}`);

  // Serve static assets
  app.use('/assets/*', serveStatic({ root: frontendDistPath }));

  // Serve index.html for all non-API routes (SPA fallback)
  app.get('*', serveStatic({
    root: frontendDistPath,
    rewriteRequestPath: () => '/index.html',
  }));
} else {
  // In development, just return API info on root
  app.get('/', (c) => c.json({ status: 'ok', message: 'Kanban PRD API - Development Mode' }));
}

// Initialize database and start server
const port = Number(process.env.PORT || 4000);

// Configuration from environment
const TARGET_REPO = process.env.TARGET_REPO || resolve(__dirname, '../../../');
const WORKTREES_DIR = process.env.WORKTREES_DIR || resolve(__dirname, '../../worktrees');
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';
const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS || 50);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30 * 60 * 1000);

async function startup() {
  // Initialize database
  await initializeDatabase();
  console.log('Database initialized');

  // Initialize worktree manager
  try {
    initWorktreeManager({
      repoPath: TARGET_REPO,
      worktreesDir: WORKTREES_DIR,
    });
    console.log(`Worktree manager initialized (repo: ${TARGET_REPO}, worktrees: ${WORKTREES_DIR})`);
  } catch (error) {
    console.warn('Worktree manager initialization failed:', error);
    console.warn('Agent execution will not be available');
  }

  // Initialize orchestrator
  try {
    initOrchestrator({
      claudePath: CLAUDE_PATH,
      maxIterations: MAX_ITERATIONS,
      timeoutMs: TIMEOUT_MS,
    });
    console.log('Orchestrator initialized');
  } catch (error) {
    console.warn('Orchestrator initialization failed:', error);
  }

  console.log(`Server running on http://localhost:${port}`);
  console.log(`Environment: ${isProduction ? 'production' : 'development'}`);
}

startup().catch(console.error);

// Extended WebSocket data to support both general and terminal connections
interface ExtendedWebSocketData extends WebSocketData {
  type: 'general' | 'terminal';
  ticketId?: string;
}

// Start Bun server with both HTTP and WebSocket support
const server = Bun.serve<ExtendedWebSocketData>({
  port,
  fetch(req, server) {
    const url = new URL(req.url);

    // Handle terminal WebSocket upgrade
    if (url.pathname.startsWith('/ws/terminal/')) {
      const ticketId = url.pathname.split('/').pop();
      if (!ticketId) {
        return new Response('Missing ticket ID', { status: 400 });
      }

      const upgraded = server.upgrade(req, {
        data: {
          clientId: generateClientId(),
          subscribedTickets: new Set<string>(),
          type: 'terminal' as const,
          ticketId,
        },
      });
      if (upgraded) {
        return undefined;
      }
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // Handle general WebSocket upgrade
    if (url.pathname === '/ws') {
      const clientId = generateClientId();
      const upgraded = server.upgrade(req, {
        data: {
          clientId,
          subscribedTickets: new Set<string>(),
          type: 'general' as const,
        },
      });
      if (upgraded) {
        return undefined;
      }
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // Handle regular HTTP requests with Hono
    return app.fetch(req);
  },
  websocket: {
    async open(ws) {
      const data = ws.data;
      if (data.type === 'terminal' && data.ticketId) {
        addClientToSession(data.ticketId, ws as any);
        // Start terminal if not already running
        await startTerminalSession(data.ticketId);
      } else {
        websocketHandlers.open(ws as any);
      }
    },
    message(ws, message) {
      const data = ws.data;
      if (data.type === 'terminal' && data.ticketId) {
        // Parse message and send to terminal
        try {
          const msg = JSON.parse(message.toString());
          if (msg.type === 'input' && msg.data) {
            sendToTerminal(data.ticketId, msg.data);
          } else if (msg.type === 'resize') {
            // Terminal resize - log for now, socat doesn't easily support dynamic resize
            console.log(`Terminal resize request: ${msg.cols}x${msg.rows}`);
          }
        } catch {
          // Raw input
          sendToTerminal(data.ticketId, message.toString());
        }
      } else {
        websocketHandlers.message(ws as any, message);
      }
    },
    close(ws) {
      const data = ws.data;
      if (data.type === 'terminal' && data.ticketId) {
        removeClientFromSession(data.ticketId, ws as any);
      } else {
        websocketHandlers.close(ws as any);
      }
    },
  },
});

console.log(`Started server: http://localhost:${port}`);

// Graceful shutdown
const shutdown = () => {
  console.log('\nShutting down gracefully...');
  server.stop();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
