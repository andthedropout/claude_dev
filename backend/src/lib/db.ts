import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';

// Create SQLite database (file-based)
const sqlite = new Database('data.db');

// Enable WAL mode for better concurrent access
sqlite.exec('PRAGMA journal_mode = WAL;');

// Create drizzle instance
export const db = drizzle(sqlite, { schema });

// Initialize database with default columns
export async function initializeDatabase() {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      triggers_agent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      column_id TEXT REFERENCES columns(id),
      position INTEGER NOT NULL DEFAULT 0,
      priority TEXT DEFAULT 'medium',
      session_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prds (
      id TEXT PRIMARY KEY,
      ticket_id TEXT REFERENCES tickets(id),
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      sender_type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      ticket_id TEXT REFERENCES tickets(id),
      status TEXT NOT NULL DEFAULT 'IDLE',
      worktree_path TEXT,
      session_id TEXT,
      iteration_count INTEGER DEFAULT 0,
      max_iterations INTEGER DEFAULT 50,
      started_at TEXT,
      completed_at TEXT,
      exit_code INTEGER,
      summary TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Add session_id to tickets if it doesn't exist
  try {
    sqlite.exec('ALTER TABLE tickets ADD COLUMN session_id TEXT;');
    console.log('Added session_id column to tickets');
  } catch {
    // Column already exists, ignore
  }

  // Seed default columns if none exist
  const existingColumns = sqlite.query('SELECT COUNT(*) as count FROM columns').get() as { count: number };

  if (existingColumns.count === 0) {
    const defaultColumns = [
      { id: 'backlog', name: 'Backlog', position: 0, triggers_agent: 0 },
      { id: 'prd-review', name: 'PRD Review', position: 1, triggers_agent: 0 },
      { id: 'in-progress', name: 'In Progress', position: 2, triggers_agent: 1 },
      { id: 'blocked', name: 'Blocked', position: 3, triggers_agent: 0 },
      { id: 'review', name: 'Review', position: 4, triggers_agent: 0 },
      { id: 'done', name: 'Done', position: 5, triggers_agent: 0 },
    ];

    const insert = sqlite.prepare(
      'INSERT INTO columns (id, name, position, triggers_agent) VALUES (?, ?, ?, ?)'
    );

    for (const col of defaultColumns) {
      insert.run(col.id, col.name, col.position, col.triggers_agent);
    }

    console.log('Initialized default columns');
  }
}

export { sqlite };
