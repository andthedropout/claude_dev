import { Hono } from 'hono';
import { db } from '../lib/db';
import { tickets, messages } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { broadcastToTicket } from '../lib/websocket';
import { sendToTerminal, startTerminalSession, getTerminalSession } from '../lib/terminal';

const chat = new Hono();

// Chat now sends input to the terminal session instead of running a separate process
// The terminal is the ONE real Claude session, chat is just a nicer interface
chat.post('/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');
  const { content } = await c.req.json<{ content: string }>();

  // Get ticket
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  // Save user message to DB (for chat history display)
  const userMsgId = nanoid();
  await db.insert(messages).values({
    id: userMsgId,
    ticketId,
    content,
    senderType: 'human',
    createdAt: new Date().toISOString(),
  });

  // Ensure terminal session exists
  let session = getTerminalSession(ticketId);
  if (!session?.process) {
    console.log(`Starting terminal session for chat on ticket ${ticketId}`);
    await startTerminalSession(ticketId);
  }

  // Send the message to the terminal
  // The terminal is the real Claude session - we just type the message into it
  sendToTerminal(ticketId, content + '\n');

  const userMessage = {
    id: userMsgId,
    ticketId,
    content,
    senderType: 'human' as const,
    createdAt: new Date().toISOString()
  };

  // Broadcast the user message
  broadcastToTicket(ticketId, { type: 'message.created', payload: userMessage });

  // Response will come via terminal WebSocket stream
  // We just acknowledge that the message was sent
  return c.json({
    userMessage,
    sent: true,
    message: 'Message sent to terminal session. Response will appear in terminal.'
  });
});

export { chat as chatRouter };
