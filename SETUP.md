# Kanban PRD Manager - Setup Instructions

## Quick Start

### 1. Rebuild the Docker container with Claude Code

```bash
docker compose down
docker compose build
docker compose up -d
```

### 2. Authenticate Claude Code (one-time setup)

Run the setup script to authenticate Claude in the container:

```bash
./setup-claude.sh
```

This will:
- Open a shell in the container as `appuser`
- Allow you to run `claude` to authenticate
- Save your credentials to a persistent Docker volume

Inside the container shell, run:
```bash
claude
```

Follow the authentication prompts. Once complete, type `exit` to leave the container.

### 3. Verify Claude is working

Check that Claude is installed and authenticated:

```bash
docker exec -u appuser kanban-prd-manager claude --version
```

## Architecture

### Claude Sessions

The system uses two types of Claude Code sessions:

1. **Interactive terminals** (`terminal.ts`):
   - Full PTY sessions users can interact with
   - Supports resuming sessions by ID
   - Great for debugging and manual work

2. **Autonomous agents** (`orchestrator.ts`):
   - Headless Claude sessions that work on PRDs
   - Ralph Wiggum loop (keeps trying until done or blocked)
   - Automatically creates git worktrees for isolation

### File Structure

```
backend/
  src/
    lib/
      terminal.ts      # PTY terminal sessions with Claude
      orchestrator.ts  # Autonomous agent loop
      worktree.ts      # Git worktree management
      db.ts           # SQLite database
      schema.ts       # Database schema
```

## Troubleshooting

### "EROFS: read-only file system" errors

This means Claude can't write to its config directory. Make sure:
1. The container was built with the new Dockerfile
2. The `claude-config` volume is mounted with `:rw` (read-write)
3. You've run the setup script to authenticate

### Claude not found in container

Make sure the Dockerfile has:
```dockerfile
RUN curl -fsSL https://storage.googleapis.com/anthropic-cli/install.sh | bash
ENV PATH="/home/appuser/.local/bin:$PATH"
```

And that you've rebuilt the container.

### Authentication issues

Delete the Claude config volume and re-authenticate:

```bash
docker compose down
docker volume rm kanban-claude-config
docker compose up -d
./setup-claude.sh
```

## Environment Variables

Set these in `docker-compose.yml` or `.env`:

- `TARGET_REPO`: Path to your project repo (default: `.`)
- `CLAUDE_PATH`: Claude CLI command (default: `claude`)
- `MAX_ITERATIONS`: Max agent loop iterations (default: `50`)
- `TIMEOUT_MS`: Agent timeout in ms (default: `1800000` = 30 min)
