import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Kanban columns
export const columns = sqliteTable('columns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  triggersAgent: integer('triggers_agent', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

// Tickets (Kanban cards)
export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  columnId: text('column_id').references(() => columns.id),
  position: integer('position').notNull().default(0),
  priority: text('priority').default('medium'),
  sessionId: text('session_id'), // Claude Code session ID
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
});

// PRDs (Product Requirement Documents)
export const prds = sqliteTable('prds', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').references(() => tickets.id),
  content: text('content').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
});

// Messages (chat per ticket)
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').references(() => tickets.id).notNull(),
  senderType: text('sender_type').notNull(), // 'human', 'agent', 'system'
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

// Agents
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').references(() => tickets.id),
  status: text('status').notNull().default('IDLE'), // IDLE, STARTING, RUNNING, BLOCKED, COMPLETED, FAILED
  worktreePath: text('worktree_path'),
  sessionId: text('session_id'),
  iterationCount: integer('iteration_count').default(0),
  maxIterations: integer('max_iterations').default(50),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  exitCode: integer('exit_code'),
  summary: text('summary'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

// Types
export type Column = typeof columns.$inferSelect;
export type NewColumn = typeof columns.$inferInsert;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type PRD = typeof prds.$inferSelect;
export type NewPRD = typeof prds.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
