# Multi-stage Dockerfile for Kanban PRD Manager
# Builds frontend and backend, bundles into a single image

# =============================================================================
# Stage 1: Build Frontend
# =============================================================================
FROM oven/bun:1 AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN bun run build

# =============================================================================
# Stage 2: Build Backend
# =============================================================================
FROM oven/bun:1 AS backend-builder

# Install python3 for PTY handling (needed for dev mode)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Copy backend package files
COPY backend/package.json backend/bun.lock* ./

# Install dependencies (production only)
RUN bun install --frozen-lockfile --production

# Copy backend source
COPY backend/ ./

# =============================================================================
# Stage 3: Runtime
# =============================================================================
FROM oven/bun:1-slim AS runtime

# Install git for worktree management, curl for health checks, python3 for PTY
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    python3 \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash appuser

# Install Claude Code for the appuser
USER appuser
WORKDIR /home/appuser

# Download and install Claude Code native binary
RUN curl -fsSL https://storage.googleapis.com/anthropic-cli/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/appuser/.local/bin:$PATH"

# Create .claude directory with proper permissions
RUN mkdir -p /home/appuser/.claude && \
    chmod 755 /home/appuser/.claude

USER root

WORKDIR /app

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy backend with dependencies
COPY --from=backend-builder /app/backend ./backend

# Create directories for data and worktrees
RUN mkdir -p /app/data /app/worktrees && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Environment variables with defaults
ENV PORT=4000 \
    NODE_ENV=production \
    DATABASE_PATH=/app/data/kanban.db \
    TARGET_REPO=/repo \
    WORKTREES_DIR=/app/worktrees \
    CLAUDE_PATH=claude \
    MAX_ITERATIONS=50 \
    TIMEOUT_MS=1800000

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:4000/ || exit 1

# Start the application
WORKDIR /app/backend
CMD ["bun", "run", "src/index.ts"]
