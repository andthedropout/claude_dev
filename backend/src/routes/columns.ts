import { Hono } from 'hono';
import { db } from '../lib/db';
import { columns } from '../lib/schema';
import { eq } from 'drizzle-orm';

const app = new Hono();

// Get all columns
app.get('/', async (c) => {
  const allColumns = await db.select().from(columns).orderBy(columns.position);
  return c.json(allColumns);
});

// Get column by ID
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const column = await db.select().from(columns).where(eq(columns.id, id));

  if (column.length === 0) {
    return c.json({ error: 'Column not found' }, 404);
  }

  return c.json(column[0]);
});

export default app;
