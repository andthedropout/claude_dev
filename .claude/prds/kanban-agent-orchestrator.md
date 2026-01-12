# Kanban PRD Manager with Claude Code Agent Orchestration

**PRD Version:** 1.0
**Status:** Draft
**Created:** 2026-01-11
**Location:** `.claude/prds/kanban-agent-orchestrator.md`

---

## Vision Summary

A web-based Kanban board for managing PRDs (Product Requirement Documents) that can assign work to autonomous Claude Code agents. Each ticket represents a feature/task with an associated PRD. Users chat with Claude to refine the PRD, then move it to "In Progress" to spawn an agent that works in an isolated git worktree. Agents run in Ralph Wiggum loops until completion, can ask questions via ticket comments, and expose their work on separate ports for preview.

---

## Key Technical Discoveries

### Claude Code Integration Options

| Approach | Pros | Cons | Best For |
|----------|------|------|----------|
| **Headless CLI** (`claude -p`) | Simple, JSON output, session resumable | Some TTY issues reported, stdin limits | MVP, scripted tasks |
| **Claude Agent SDK** (TS/Python) | Full control, hooks, custom tools | More complex setup | Production, custom workflows |
| **Ralph Wiggum Pattern** | Continuous execution until done | Cost management needed | Long-running autonomous work |
| **claude-agent-server** | WebSocket wrapper, remote control | Third-party dependency | Web integration |

### Agent Isolation via Git Worktrees

- Each agent gets its own worktree (~150MB vs 1GB for full clone)
- Worktrees share `.git/objects` but have independent `HEAD`, `index`, file state
- Git prevents same branch in two worktrees (natural conflict prevention)
- Worktree locking prevents accidental deletion while agent is active
- Tools like `git-worktree-runner` and `Treehouse Worktree` exist for automation

### Communication Architecture

```
Web UI <--WebSocket--> API Server <--WebSocket--> Agent Orchestrator
                                                        |
                                    +-------------------+-------------------+
                                    |                   |                   |
                               Agent #1            Agent #2            Agent #3
                            (Container)          (Container)          (Container)
                            Port: 5001           Port: 5002           Port: 5003
                            Worktree: A          Worktree: B          Worktree: C
```

---

## How It Actually Works (Technical Deep Dive)

### The Simple Version

```
┌─────────────────────────────────────────────────────────────────┐
│  Your Browser                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  React App (Vite + shadcn/ui + Tailwind)                │    │
│  │  - Kanban board                                          │    │
│  │  - PRD editor                                            │    │
│  │  - Chat panel                                            │    │
│  └─────────────────────────────────────────────────────────┘    │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP/WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server (Bun + Hono)                                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  SQLite         │  │  WebSocket Hub  │  │  Orchestrator   │ │
│  │  (tickets, PRDs,│  │  (real-time     │  │  (spawns claude │ │
│  │   messages)     │  │   updates)      │  │   CLI processes)│ │
│  └─────────────────┘  └─────────────────┘  └────────┬────────┘ │
└─────────────────────────────────────────────────────┼───────────┘
                                                      │
                                                      │ Bun.spawn()
                                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Terminal Process (Child of Bun server)                         │
│                                                                  │
│  $ cd /worktrees/ticket-123                                     │
│  $ claude -p "Implement the login feature per PRD" \            │
│           --output-format stream-json                           │
│                                                                  │
│  (Claude Code CLI runs, makes file changes, runs tests, etc.)  │
│  stdout/stderr → piped back to server → WebSocket → browser    │
└─────────────────────────────────────────────────────────────────┘
```

### What Each Piece Does

**1. Frontend (shadcn + Tailwind - YES, this is all you need for UI)**
- React components for Kanban board, chat, PRD editor
- shadcn/ui provides pre-built components (buttons, cards, dialogs)
- Tailwind for styling
- WebSocket client for real-time updates
- No other UI libraries needed

**2. Backend (Bun + Hono - separate from frontend but same Docker image)**
- Hono routes: `app.get('/api/tickets', ...)`, `app.post('/api/agents', ...)`
- Runs on Bun (fast JavaScript runtime, alternative to Node.js)
- Handle database operations (SQLite via Drizzle ORM)
- Manage WebSocket connections (Bun's native WebSocket or Hono)
- **Spawn Claude CLI as child processes**

**3. Agent Execution (Bun.spawn - literally terminal sessions)**

```typescript
// When ticket moves to "In Progress":
async function startAgent(ticketId: string, prdContent: string) {
  const worktreePath = `/worktrees/ticket-${ticketId}`;

  // Bun.spawn() runs a real terminal process
  const agent = Bun.spawn(['claude', '-p', prdContent, '--output-format', 'stream-json'], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  // Stream output back to the browser via WebSocket
  const reader = agent.stdout.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    websocket.send(JSON.stringify({ ticketId, data: new TextDecoder().decode(value) }));
  }

  // Agent finished
  await agent.exited;
  moveTicketToReview(ticketId);
}
```

**4. Git Worktrees (simple-git npm package)**

```typescript
import simpleGit from 'simple-git';

async function createWorktree(ticketId: string) {
  const git = simpleGit('/your-project');

  // Create a new worktree for this ticket
  await git.raw([
    'worktree', 'add',
    `/worktrees/ticket-${ticketId}`,
    '-b', `ticket/${ticketId}`
  ]);

  // Agent now has its own directory to work in
  // Main branch stays untouched
}
```

### Why We Need a Server (Can't Do This From Browser)

Browsers can't:
- Read/write files on disk
- Spawn terminal processes
- Access git repositories
- Create worktrees

So we need Bun + Hono for server-side operations. The frontend (React/Vite) and backend (Bun/Hono) are separate codebases but packaged in the same Docker image.

---

## Architecture Components (Simplified for MVP)

### 1. Frontend (React + Vite + shadcn + Tailwind)
- Kanban board with drag-drop
- Chat panel per ticket
- PRD markdown editor (Monaco)
- Agent status indicators
- WebSocket client for real-time updates
- Builds to static files, served by Bun

### 2. Backend (Bun + Hono)
- `/api/tickets` - CRUD operations
- `/api/chat` - PRD discussion with Claude API
- `/api/agents` - Start/stop/status
- WebSocket endpoint for real-time updates
- Serves static frontend files

### 3. Orchestrator (Bun code running on server)
- Spawns `claude` CLI via `Bun.spawn()`
- Monitors process output
- Detects completion/blocked states
- Manages job queue (one agent at a time for MVP)

### 4. Data Layer (SQLite - single file, no setup)
- Tickets, PRDs, messages, agent state
- Drizzle ORM for type-safe queries
- SQLite file lives in container volume
- **WAL mode enabled** for better concurrent access

**Scalability Note:** SQLite is fine for single-agent MVP and likely for 5+ agents with intermittent writes. If you hit concurrency issues (10+ agents, team usage), migrate to PostgreSQL - Drizzle ORM makes this a one-line change. Schema stays identical.

---

## Agent Lifecycle (Autonomous Model)

**Key Principle:** Agents work autonomously in the background. They only interrupt when blocked.

```
             ┌─────────────────────────────────────────┐
             │           KANBAN COLUMNS                │
             │                                         │
  [Backlog] → [PRD Review] → [In Progress] → [Review] → [Done]
                                   │             ↑
                                   │             │ (verified)
                                   ▼             │
                              [Blocked] ────────►│
                              (waiting for       │
                               human response)   │
             └─────────────────────────────────────────┘

Agent State Machine:
┌────────┐     ┌──────────┐     ┌─────────┐
│  IDLE  │────►│ STARTING │────►│ RUNNING │
└────────┘     └──────────┘     └────┬────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
              ┌──────────┐    ┌───────────┐    ┌───────────┐
              │ BLOCKED  │    │ COMPLETED │    │  FAILED   │
              │ (asks Q) │    │ (verified)│    │ (crashed) │
              └────┬─────┘    └─────┬─────┘    └───────────┘
                   │                │
             human responds         │
                   │                ▼
                   └───────►  ┌──────────┐
                              │ CLEANUP  │ → Create PR, remove worktree
                              └──────────┘
```

### The Happy Path

1. **User refines PRD** in ticket chat (talking to Claude about requirements)
2. **User moves ticket to "In Progress"** → Orchestrator triggered
3. **Agent spawns** → Creates worktree, installs deps, starts preview server
4. **Agent works in Ralph Wiggum loop** → Reads PRD, implements, tests, iterates
5. **Agent verifies completion** → Tests pass, completion criteria met
6. **Agent moves ticket to "Review"** → Posts summary, PR link
7. **User previews work** → Opens preview URL, reviews code
8. **User approves** → Ticket to "Done", agent cleans up

### The Blocked Path

1. Agent encounters ambiguity or blocker it can't resolve
2. **Agent posts question** as comment on ticket
3. **Agent sets ticket status to "Blocked"** (visible on Kanban)
4. **Agent pauses** (Ralph Wiggum loop suspended, not killed)
5. **Event emitted** → Can trigger notification (push, email, Slack)
6. User sees blocked ticket, reads question
7. **User responds** in ticket chat
8. **Agent resumes** → Sees response, continues work

---

## Event-Driven Architecture

### Design: Modular Event System

Every significant action emits an event that can trigger integrations:

```typescript
// Core events that flow through the system
type KanbanEvent =
  // Ticket events
  | { type: 'ticket.created'; payload: Ticket }
  | { type: 'ticket.moved'; payload: { ticketId: string; from: Column; to: Column } }
  | { type: 'ticket.blocked'; payload: { ticketId: string; reason: string } }
  | { type: 'ticket.unblocked'; payload: { ticketId: string } }

  // Agent events
  | { type: 'agent.started'; payload: { ticketId: string; agentId: string } }
  | { type: 'agent.progress'; payload: { agentId: string; message: string } }
  | { type: 'agent.question'; payload: { agentId: string; question: string } }
  | { type: 'agent.completed'; payload: { agentId: string; summary: string; prUrl?: string } }
  | { type: 'agent.failed'; payload: { agentId: string; error: string } }

  // PRD events
  | { type: 'prd.updated'; payload: { prdId: string; version: number } }

  // Human events
  | { type: 'human.responded'; payload: { ticketId: string; message: string } };
```

### Integration Hooks

```typescript
// Plugin architecture for integrations
interface IntegrationPlugin {
  name: string;
  events: string[];  // Which events to subscribe to
  handler: (event: KanbanEvent) => Promise<void>;
}

// Example: Slack integration (future)
const slackPlugin: IntegrationPlugin = {
  name: 'slack',
  events: ['agent.question', 'agent.completed', 'ticket.blocked'],
  handler: async (event) => {
    if (event.type === 'agent.question') {
      await slack.postMessage({
        channel: '#dev-agents',
        text: `🤖 Agent needs help on ticket: ${event.payload.question}`
      });
    }
  }
};

// Example: Email integration
const emailPlugin: IntegrationPlugin = {
  name: 'email',
  events: ['ticket.blocked'],
  handler: async (event) => {
    await sendEmail({
      to: 'dev@company.com',
      subject: `Ticket blocked: ${event.payload.reason}`
    });
  }
};

// Example: Webhook integration
const webhookPlugin: IntegrationPlugin = {
  name: 'webhook',
  events: ['*'],  // All events
  handler: async (event) => {
    await fetch(process.env.WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify(event)
    });
  }
};
```

### Event Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        EVENT BUS                                │
│                                                                 │
│  ticket.blocked ─────┬──────► Slack Plugin ──► #dev-agents      │
│                      ├──────► Email Plugin ──► dev@company.com  │
│                      ├──────► Webhook Plugin ──► your-webhook   │
│                      └──────► Push Notification Plugin          │
│                                                                 │
│  agent.completed ────┬──────► Slack Plugin ──► "✅ Done!"       │
│                      └──────► Analytics Plugin ──► metrics      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

This architecture allows adding Slack, PagerDuty, Discord, or any integration later without changing core code.

---

## Potential Problems & Mitigations

| Problem | Risk | Mitigation |
|---------|------|------------|
| **Runaway agents** | Cost, resources | Max iterations, time limits, watchdog, manual kill |
| **Worktree conflicts** | Git corruption | Worktree locking, branch isolation, file overlap detection |
| **Port exhaustion** | Can't preview | Aggressive cleanup, dynamic range, on-demand allocation |
| **Lost state on crash** | Orphaned agents | Persist to Redis/DB, recovery scan on startup, Docker labels |
| **Human forgets to respond** | Agent blocks forever | Notifications, timeout with defaults, async continuation |
| **Security (agent escape)** | System compromise | Sandboxed containers, tool allowlists, no network to host |
| **PRD version conflicts** | Data loss | Optimistic locking, version history, CRDT for collab editing |

---

## User Decisions

- **Frontend:** React + Vite (no SSR - this is a dev tool, not public site)
- **Backend:** Bun + Hono (lightweight, fast, TypeScript-native)
- **Database:** SQLite (single file, everything in one place)
- **UI:** shadcn/ui + Tailwind (components + styling)
- **Deployment:** Flexible/portable Docker image - can be added to existing project stacks or run standalone
- **Agent Scale:** **Single agent MVP** → Multi-agent as later enhancement
- **Repo Model:** Single shared repo with worktrees for isolation
- **Git/PR:** Separate concern - future agents will listen for "Ready for Review" state

---

## MVP Strategy: Single Agent First

**Why start with single concurrency:**

1. **No port conflicts** - Agent uses whatever ports the project normally uses
2. **No database isolation** - Only one worktree active, uses project's normal DB
3. **True drop-in** - Works with any project without configuration
4. **Core flow validated** - Kanban → Agent → Worktree → Work → Review
5. **Infrastructure still applies** - Orchestrator, worktree manager, events work for multi-agent too
6. **Lower risk** - Debug one agent before debugging five

**What single-agent MVP looks like:**

```
Queue: [Ticket A] [Ticket B] [Ticket C]  ← Tickets waiting
                     ↓
              Agent processes one at a time
                     ↓
            [Ticket A - In Progress]
                     ↓
            Worktree created, agent works
                     ↓
            [Ticket A - Review] → [Ticket B - In Progress] → ...
```

**Worktrees still valuable for single agent:**
- Keeps `main` branch clean while agent experiments
- Natural git history per ticket
- Easy to review/discard work
- Agent can "break things" without affecting your dev environment

**Path to multi-agent (Phase 3+):**
1. Add port allocation manager
2. Add docker-compose.override.yml generation (for projects that need it)
3. Add agent pool with concurrency limits
4. Add database isolation options (configurable per project)

**What changes between single and multi:**

| Component | Single MVP | Multi (Later) |
|-----------|------------|---------------|
| Worktree manager | Same | Same |
| Event bus | Same | Same |
| Orchestrator | Queue mode | Pool mode |
| Port manager | Not needed | Add |
| DB isolation | Not needed | Add (optional) |

**Bottom line:** No architectural regret. Single agent uses the same building blocks, just simpler orchestration.

---

## The Multi-Agent Preview Problem (Solved!)

**Challenge:** How do you preview multiple agents' work simultaneously while they're all working on the same repo?

**Key Insight:** Git worktrees are **completely independent file directories**. They share git history but have separate:
- Working files (different code states)
- `node_modules` (each can run its own dependencies)
- Running processes (each can have its own dev server)

### Solution: Each Agent Gets Its Own Preview Stack

```
Main Repo (.git)
     │
     ├── worktree-ticket-123/     → Dev server on port 5001
     │   ├── src/
     │   ├── node_modules/
     │   └── (Agent #1 working here)
     │
     ├── worktree-ticket-456/     → Dev server on port 5002
     │   ├── src/
     │   ├── node_modules/
     │   └── (Agent #2 working here)
     │
     └── worktree-ticket-789/     → Dev server on port 5003
         ├── src/
         ├── node_modules/
         └── (Agent #3 working here)
```

### How Preview Works

1. **Agent spawns** → Creates worktree, installs deps, starts dev server on allocated port
2. **Traefik routes** → `yourmachine.local/preview/123` → port 5001
3. **You open preview** → See live app with hot-reload as agent makes changes
4. **Post feedback** → Agent sees your message, incorporates feedback, you see changes live
5. **Multiple previews** → Open tabs for each ticket, all updating independently

### Giving Notes While Agent Works

```
┌─────────────────────────────────────────────────────────────┐
│  Ticket #123 - Add user authentication                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌──────────────────────────────┐ │
│  │ Chat Panel          │  │ Preview (localhost:5001)     │ │
│  │                     │  │ ┌────────────────────────┐   │ │
│  │ [Agent]: Working on │  │ │  Your App Running      │   │ │
│  │ login component...  │  │ │  ┌──────┐              │   │ │
│  │                     │  │ │  │Login │ ← You see    │   │ │
│  │ [You]: Make the     │  │ │  └──────┘   changes    │   │ │
│  │ button blue instead │  │ │             live!      │   │ │
│  │                     │  │ └────────────────────────┘   │ │
│  │ [Agent]: Got it,    │  │                              │ │
│  │ changing to blue... │  │  (Hot reload updates as     │ │
│  │                     │  │   agent saves files)         │ │
│  └─────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Technical Implementation

```typescript
// When agent starts working on a ticket:
async function setupAgentPreview(ticketId: string, worktreePath: string) {
  const port = await portManager.allocate(); // e.g., 5001

  // Run the project's dev server in the worktree
  const devProcess = spawn('npm', ['run', 'dev'], {
    cwd: worktreePath,
    env: { ...process.env, PORT: port.toString() }
  });

  // Register with reverse proxy for nice URLs
  await traefik.addRoute(`/preview/${ticketId}`, `localhost:${port}`);

  return { port, previewUrl: `/preview/${ticketId}` };
}
```

### For Django/React Projects (Your Stack)

**The Port Conflict Problem:**
Your main project uses postgres:5432, django:8000, react:3000. If multiple agents each run `docker-compose up` in their worktrees, they all fight for the same ports.

**Solution: Auto-Generated docker-compose.override.yml per Worktree**

When an agent starts, the orchestrator generates a unique port mapping:

```yaml
# worktree-ticket-123/docker-compose.override.yml (auto-generated)
services:
  django:
    ports:
      - "8001:8000"    # Map host 8001 → container 8000
    environment:
      - ALLOWED_HOSTS=localhost,preview-123.localhost

  react:
    ports:
      - "3001:3000"
    environment:
      - VITE_API_URL=http://localhost:8001

  postgres:
    ports:
      - "5433:5432"   # Each agent gets its own DB port

# worktree-ticket-456/docker-compose.override.yml
services:
  django:
    ports:
      - "8002:8000"
  react:
    ports:
      - "3002:3000"
  postgres:
    ports:
      - "5434:5432"
```

**How It Works:**

1. Agent spawns → Orchestrator allocates port range (e.g., 8001-8003 for ticket-123)
2. Orchestrator generates `docker-compose.override.yml` in worktree
3. Agent runs `docker-compose -f docker-compose.yml -f docker-compose.override.yml up`
4. Services start on unique ports, no conflicts
5. Main project on :8000 stays untouched

**Port Allocation Strategy:**

```typescript
// Each ticket gets a "port block" - a range of related ports
interface PortBlock {
  ticketId: string;
  django: number;    // 8001, 8002, 8003...
  react: number;     // 3001, 3002, 3003...
  postgres: number;  // 5433, 5434, 5435...
}

// Allocation: ticket index * 1 + base
// Ticket 123 (index 0): django=8001, react=3001, postgres=5433
// Ticket 456 (index 1): django=8002, react=3002, postgres=5434
```

**Nice URLs with Traefik:**

Instead of remembering port numbers, use subdomains:

```
ticket-123.preview.localhost → routes to django:8001, react:3001
ticket-456.preview.localhost → routes to django:8002, react:3002
```

Traefik config (auto-generated per agent):
```yaml
http:
  routers:
    ticket-123-django:
      rule: "Host(`ticket-123.preview.localhost`) && PathPrefix(`/api`)"
      service: ticket-123-django
    ticket-123-react:
      rule: "Host(`ticket-123.preview.localhost`)"
      service: ticket-123-react
  services:
    ticket-123-django:
      loadBalancer:
        servers:
          - url: "http://localhost:8001"
    ticket-123-react:
      loadBalancer:
        servers:
          - url: "http://localhost:3001"
```

**Your Main Project Stays Untouched:**
- Main dev at `localhost:8000` - unchanged
- Agent previews at `ticket-XXX.preview.localhost`
- No port conflicts, no manual configuration

---

## Database & Volume Isolation

**Problem:** If agents share the same postgres volume, they corrupt each other's data.

**Solution: Per-Agent Database Volumes**

```yaml
# docker-compose.override.yml for ticket-123
services:
  postgres:
    volumes:
      - ticket-123-pgdata:/var/lib/postgresql/data  # Unique volume
    ports:
      - "5433:5432"

volumes:
  ticket-123-pgdata:
    name: kanban-ticket-123-pgdata
```

**Database Seeding Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **Fresh DB + migrations** | Clean state, fast | No test data |
| **Clone from main** | Realistic data | Slow, disk space |
| **Seed script** | Reproducible | Must maintain script |
| **Shared read-only + separate write** | Space efficient | Complex setup |

**Recommended:** Fresh DB + migrations + seed script. Agent runs:
```bash
docker-compose up -d postgres
docker-compose exec django python manage.py migrate
docker-compose exec django python manage.py loaddata seed.json
```

**Cleanup:** When ticket completes, orchestrator removes the volume:
```bash
docker volume rm kanban-ticket-123-pgdata
```

**Other Shared Resources:**

| Resource | Isolation Strategy |
|----------|-------------------|
| Redis | Per-agent Redis instance OR key prefixing (`ticket-123:*`) |
| Elasticsearch | Per-agent index prefix (`ticket-123-products`) |
| S3/MinIO | Per-agent bucket OR folder prefix |
| File uploads | Per-agent volume mount |

---

## Flexible Deployment Model

### Design Goal: Drop-in Container

The Kanban PRD Manager should work as a **single Docker image** that can be:

1. **Standalone** - Run by itself for any project
2. **Composed** - Added to existing docker-compose stacks
3. **Sidecar** - Attached to running projects

### How It Attaches to Existing Projects

```yaml
# Your existing project's docker-compose.yml
services:
  django:
    build: ./backend
    ports:
      - "8000:8000"

  react:
    build: ./frontend
    ports:
      - "3000:3000"

  # Just add the kanban-prd service!
  kanban-prd:
    image: kanban-prd:latest
    ports:
      - "4000:4000"      # Web UI
      - "5001-5020:5001-5020"  # Agent preview ports
    volumes:
      - .:/target-repo   # Mount your project repo
      - /var/run/docker.sock:/var/run/docker.sock  # For spawning agents
    environment:
      - TARGET_REPO=/target-repo
      - PREVIEW_PORT_RANGE=5001-5020
```

### Self-Contained Architecture

The kanban-prd image bundles everything:

```
kanban-prd:latest
├── Next.js Web UI (port 4000)
├── API + WebSocket Server
├── Agent Orchestrator
├── SQLite database (or connect to external Postgres)
├── Built-in Redis (or connect to external)
├── Claude Code CLI pre-installed
├── Git + worktree tools
└── Traefik for preview routing
```

### Three Deployment Modes

**Mode 1: Fully Standalone**
```bash
docker run -p 4000:4000 -p 5001-5010:5001-5010 \
  -v ~/my-project:/repo \
  -v /var/run/docker.sock:/var/run/docker.sock \
  kanban-prd:latest
```

**Mode 2: With External Database (Production)**
```yaml
services:
  kanban-prd:
    image: kanban-prd:latest
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/kanban
      - REDIS_URL=redis://redis:6379
```

**Mode 3: Kubernetes Sidecar** (Future)
```yaml
# Add as sidecar to your deployment
containers:
  - name: kanban-prd
    image: kanban-prd:latest
    # Share volume with your app for repo access
```

---

## Proposed Tech Stack

### MVP Stack (All-in-One Container)
- **Frontend:** React + Vite + Tailwind + shadcn/ui
- **Backend:** Bun + Hono
- **Database:** SQLite (single file) + Drizzle ORM
- **Real-time:** Bun native WebSocket
- **Agents:** `Bun.spawn()` spawning Claude CLI
- **Worktrees:** `simple-git` npm package (works with Bun)
- **State:** Zustand (client-side)

### Production Enhancements (Later)
- **Database:** PostgreSQL (optional, for multi-user)
- **Queue:** BullMQ or custom (for multi-agent)
- **Agents:** Docker-in-Docker for full isolation
- **Routing:** Traefik for dynamic port routing

---

## Implementation Phases

### Phase 1: Foundation - Kanban + PRD Chat
**Goal:** Working Kanban board where you can chat with Claude to refine PRDs

- [ ] Project scaffolding (Next.js 14, TypeScript, Tailwind, shadcn/ui)
- [ ] SQLite database setup with Drizzle ORM
- [ ] Kanban board UI (columns: Backlog, PRD Review, In Progress, Blocked, Review, Done)
- [ ] Ticket CRUD (create, edit, drag-drop between columns)
- [ ] PRD markdown editor per ticket (Monaco or similar)
- [ ] Chat panel per ticket (UI + basic Claude API integration for PRD discussion)
- [ ] Real-time updates with Socket.io

**Verification:** Can create tickets, edit PRDs, chat with Claude about requirements, drag tickets between columns.

### Phase 2: Single Agent Execution (MVP)
**Goal:** Move ticket to "In Progress" → Single agent works on it

- [ ] Worktree manager (create, lock, list, remove)
- [ ] Simple job queue (one ticket at a time)
- [ ] Claude Code headless integration (`claude -p` with JSON output)
- [ ] Agent output streaming to ticket chat
- [ ] Ralph Wiggum loop for continuous execution
- [ ] Completion detection (tests pass, completion string found)
- [ ] Blocked state handling (agent posts question, ticket moves to Blocked)
- [ ] Human response → agent resume flow
- [ ] Basic watchdog (timeout, max iterations, kill switch)

**Verification:** Assign ticket, agent creates worktree, works in loop, completes or asks question. Next ticket auto-starts.

### Phase 3: Docker + Drop-in Deployment
**Goal:** Single portable Docker image that works with any project

- [ ] Multi-stage Dockerfile (build + runtime)
- [ ] Bundled SQLite (with external Postgres option)
- [ ] Docker Compose for local development
- [ ] Environment variable configuration
- [ ] Volume mounts for target repo
- [ ] Health checks and graceful shutdown
- [ ] Documentation: "Add to any project in 2 lines"

**Verification:** `docker run kanban-prd -v /my-project:/repo` works out of the box.

### Phase 4: Event System + Notifications
**Goal:** Modular event-driven architecture for notifications

- [ ] Event bus implementation
- [ ] Plugin system for integrations
- [ ] Webhook plugin (generic HTTP POST)
- [ ] Push notification plugin (browser notifications)
- [ ] Cost tracking per ticket/agent

**Verification:** Agent blocks → webhook fires, browser notification appears.

### Phase 5+: Future Enhancements (Not MVP)
**Goal:** Scale and integrate

- [ ] Multi-agent concurrency with port allocation
- [ ] Per-project docker-compose.override.yml generation
- [ ] Database volume isolation
- [ ] Traefik dynamic routing for preview URLs
- [ ] Slack MCP server integration
- [ ] GitHub PR creation agent (listens for "Review" state)
- [ ] Agent-to-agent handoff

---

## Project Structure

```
kanban-prd/
├── frontend/                   # React + Vite app
│   ├── src/
│   │   ├── App.tsx            # Main app with router
│   │   ├── components/
│   │   │   ├── kanban/        # Board, Column, Card
│   │   │   ├── chat/          # Chat panel, messages
│   │   │   ├── prd/           # PRD editor (Monaco)
│   │   │   └── ui/            # shadcn components
│   │   ├── stores/
│   │   │   └── kanban-store.ts  # Zustand state
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts  # WebSocket client
│   │   └── lib/
│   │       └── api.ts         # API client
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── backend/                    # Bun + Hono server
│   ├── src/
│   │   ├── index.ts           # Hono app entry
│   │   ├── routes/
│   │   │   ├── tickets.ts     # Ticket CRUD
│   │   │   ├── agents.ts      # Agent control
│   │   │   └── chat.ts        # PRD chat with Claude
│   │   ├── lib/
│   │   │   ├── db.ts          # SQLite + Drizzle
│   │   │   ├── schema.ts      # Database schema
│   │   │   ├── worktree.ts    # Git worktree manager
│   │   │   ├── orchestrator.ts  # Agent lifecycle
│   │   │   └── events.ts      # Event bus
│   │   └── websocket.ts       # WebSocket handlers
│   └── package.json
│
├── Dockerfile                  # Multi-stage build
├── docker-compose.yml          # Local dev
└── README.md
```

## Critical Files (Phase 1)

| File | Purpose |
|------|---------|
| `backend/src/lib/schema.ts` | Database schema (tickets, messages, agents, PRDs) |
| `backend/src/lib/orchestrator.ts` | Agent spawn/monitor/cleanup logic |
| `backend/src/lib/worktree.ts` | Git worktree create/lock/remove |
| `backend/src/routes/tickets.ts` | Ticket CRUD API |
| `frontend/src/components/kanban/Board.tsx` | Main Kanban UI with drag-drop |
| `frontend/src/components/chat/ChatPanel.tsx` | Ticket chat with Claude |
| `Dockerfile` | Multi-stage build (Vite + Bun) |

---

## Key Risks & Unknowns

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Claude Code headless mode issues | Medium | Fall back to Agent SDK if CLI unstable |
| Worktree + Docker volume permissions | Medium | Test early, document mount requirements |
| Preview server port conflicts | Low | Strict port allocation, fallback ranges |
| Ralph Wiggum loop runaway costs | High | Hard limits, cost tracking, kill switch |
| Agent context loss on resume | Medium | Persist full conversation, use session IDs |
| SQLite concurrency limits | Low (MVP) | WAL mode for MVP; migrate to PostgreSQL if 10+ agents or team usage |

---

## Summary

**What we're building:** A Kanban web UI for managing PRDs that spawns autonomous Claude Code agents to implement features. Start with single-agent concurrency (queue model), scale to multi-agent later.

**MVP (Phases 1-3):**
1. Kanban board + PRD chat with Claude
2. Single agent executes tickets one at a time in isolated worktrees
3. Drop-in Docker image for any project

**Final Tech Stack:**
- **Frontend:** React + Vite + shadcn/ui + Tailwind + Zustand
- **Backend:** Bun + Hono + SQLite (Drizzle ORM)
- **Agent execution:** `Bun.spawn()` running `claude` CLI
- **Worktrees:** `simple-git` for isolation

**Key architecture decisions:**
- Separate frontend/backend (React + Bun) but one Docker image
- Git worktrees for agent isolation (keeps main clean)
- SQLite for all data (tickets, PRDs, messages) - single file, zero config
- Single-agent MVP → No port conflicts, no DB isolation needed
- Event-driven plugin system (add Slack/notifications later)
- Portable Docker image (`docker run -v /project:/repo kanban-prd`)

**What we're NOT building (yet):**
- Multi-agent concurrency (Phase 5+)
- Port allocation / docker-compose.override.yml generation
- Database volume isolation
- Git/PR automation (separate agent, future)

**Next step:** Start Phase 1 - scaffold the project and build the basic Kanban + PRD chat interface.
