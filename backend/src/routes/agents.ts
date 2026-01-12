import { Hono } from 'hono';
import { db } from '../lib/db';
import { agents, tickets } from '../lib/schema';
import { eq, desc } from 'drizzle-orm';
import { getOrchestrator } from '../lib/orchestrator';
import { getWorktreeManager } from '../lib/worktree';
import { startTerminalSession, getSessionStatus } from '../lib/terminal';

const app = new Hono();

// Get orchestrator status (queue, current job)
app.get('/status', (c) => {
  try {
    const orchestrator = getOrchestrator();
    return c.json(orchestrator.getStatus());
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Get all agents
app.get('/', async (c) => {
  const result = await db.select().from(agents).orderBy(desc(agents.createdAt));
  return c.json(result);
});

// Get agent by ID
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  return c.json(agent);
});

// Start an agent for a ticket (moves ticket to in-progress and enqueues)
app.post('/start/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');

  // Verify ticket exists
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  // Update ticket to in-progress
  await db.update(tickets).set({
    columnId: 'in-progress',
    updatedAt: new Date().toISOString(),
  }).where(eq(tickets.id, ticketId));

  // Enqueue for processing
  const orchestrator = getOrchestrator();
  await orchestrator.enqueue(ticketId);

  return c.json({ message: 'Agent queued', ticketId });
});

// Resume a blocked agent with human response
app.post('/resume/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');
  const { response } = await c.req.json<{ response: string }>();

  if (!response) {
    return c.json({ error: 'Response is required' }, 400);
  }

  try {
    const orchestrator = getOrchestrator();
    await orchestrator.resumeAgent(ticketId, response);
    return c.json({ message: 'Agent resumed', ticketId });
  } catch (error) {
    return c.json({ error: String(error) }, 400);
  }
});

// Kill a running agent
app.post('/kill/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');

  try {
    const orchestrator = getOrchestrator();
    await orchestrator.killAgent(ticketId);
    return c.json({ message: 'Agent killed', ticketId });
  } catch (error) {
    return c.json({ error: String(error) }, 400);
  }
});

// List worktrees
app.get('/worktrees', async (c) => {
  try {
    const worktreeManager = getWorktreeManager();
    const worktrees = await worktreeManager.list();
    return c.json(worktrees);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Remove a worktree
app.delete('/worktrees/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');
  const force = c.req.query('force') === 'true';

  try {
    const worktreeManager = getWorktreeManager();
    await worktreeManager.remove(ticketId, force);
    return c.json({ message: 'Worktree removed', ticketId });
  } catch (error) {
    return c.json({ error: String(error) }, 400);
  }
});

// Start terminal session for a ticket
app.post('/terminal/start/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');

  // Verify ticket exists
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  try {
    await startTerminalSession(ticketId);
    const status = getSessionStatus(ticketId);
    return c.json({ message: 'Terminal started', ticketId, status });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Get terminal session status
app.get('/terminal/status/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');
  const status = getSessionStatus(ticketId);
  return c.json(status);
});

export { app as agentsRouter };
