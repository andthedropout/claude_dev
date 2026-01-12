import { Hono } from 'hono';
import { db, sqlite } from '../lib/db';
import { tickets, prds, messages } from '../lib/schema';
import { eq, and } from 'drizzle-orm';

const app = new Hono();

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Get all tickets
app.get('/', async (c) => {
  const allTickets = await db.select().from(tickets).orderBy(tickets.position);
  return c.json(allTickets);
});

// Get ticket by ID with PRD and messages
app.get('/:id', async (c) => {
  const id = c.req.param('id');

  const ticket = await db.select().from(tickets).where(eq(tickets.id, id));
  if (ticket.length === 0) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  const prd = await db.select().from(prds).where(eq(prds.ticketId, id));
  const ticketMessages = await db.select().from(messages).where(eq(messages.ticketId, id));

  return c.json({
    ...ticket[0],
    prd: prd[0] || null,
    messages: ticketMessages,
  });
});

// Create ticket
app.post('/', async (c) => {
  const body = await c.req.json();
  const { title, description, columnId } = body;

  if (!title) {
    return c.json({ error: 'Title is required' }, 400);
  }

  const ticketId = generateId();
  const prdId = generateId();
  const now = new Date().toISOString();

  // Get max position in column
  const maxPos = sqlite.query(
    'SELECT MAX(position) as max FROM tickets WHERE column_id = ?'
  ).get(columnId || 'backlog') as { max: number | null };

  const position = (maxPos?.max ?? -1) + 1;

  // Insert ticket
  await db.insert(tickets).values({
    id: ticketId,
    title,
    description: description || '',
    columnId: columnId || 'backlog',
    position,
    createdAt: now,
    updatedAt: now,
  });

  // Create empty PRD
  await db.insert(prds).values({
    id: prdId,
    ticketId,
    content: `# ${title}\n\n## Overview\n\n## Requirements\n\n## Acceptance Criteria\n`,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  const newTicket = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  const newPrd = await db.select().from(prds).where(eq(prds.ticketId, ticketId));

  return c.json({ ...newTicket[0], prd: newPrd[0] }, 201);
});

// Update ticket
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { title, description, columnId, position, priority } = body;

  const existing = await db.select().from(tickets).where(eq(tickets.id, id));
  if (existing.length === 0) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (columnId !== undefined) updates.columnId = columnId;
  if (position !== undefined) updates.position = position;
  if (priority !== undefined) updates.priority = priority;

  await db.update(tickets).set(updates).where(eq(tickets.id, id));

  const updated = await db.select().from(tickets).where(eq(tickets.id, id));
  return c.json(updated[0]);
});

// Move ticket to column
app.post('/:id/move', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { columnId, position } = body;

  const existing = await db.select().from(tickets).where(eq(tickets.id, id));
  if (existing.length === 0) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  await db.update(tickets).set({
    columnId,
    position: position ?? 0,
    updatedAt: new Date().toISOString(),
  }).where(eq(tickets.id, id));

  const updated = await db.select().from(tickets).where(eq(tickets.id, id));
  return c.json(updated[0]);
});

// Delete ticket
app.delete('/:id', async (c) => {
  const id = c.req.param('id');

  // Delete related records first
  await db.delete(messages).where(eq(messages.ticketId, id));
  await db.delete(prds).where(eq(prds.ticketId, id));
  await db.delete(tickets).where(eq(tickets.id, id));

  return c.json({ success: true });
});

// Update PRD content
app.patch('/:id/prd', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { content } = body;

  const prdResults = await db.select().from(prds).where(eq(prds.ticketId, id));
  const existingPrd = prdResults[0];
  if (!existingPrd) {
    return c.json({ error: 'PRD not found' }, 404);
  }

  await db.update(prds).set({
    content,
    version: (existingPrd.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }).where(eq(prds.ticketId, id));

  const updated = await db.select().from(prds).where(eq(prds.ticketId, id));
  return c.json(updated[0]);
});

// Add message to ticket
app.post('/:id/messages', async (c) => {
  const ticketId = c.req.param('id');
  const body = await c.req.json();
  const { content, senderType, metadata } = body;

  if (!content) {
    return c.json({ error: 'Content is required' }, 400);
  }

  const messageId = generateId();

  await db.insert(messages).values({
    id: messageId,
    ticketId,
    content,
    senderType: senderType || 'human',
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: new Date().toISOString(),
  });

  const newMessage = await db.select().from(messages).where(eq(messages.id, messageId));
  return c.json(newMessage[0], 201);
});

// Get messages for ticket
app.get('/:id/messages', async (c) => {
  const ticketId = c.req.param('id');
  const ticketMessages = await db.select().from(messages).where(eq(messages.ticketId, ticketId));
  return c.json(ticketMessages);
});

export default app;
