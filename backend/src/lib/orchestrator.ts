import type { Subprocess } from 'bun';
import { db } from './db';
import { tickets, agents, messages } from './schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getWorktreeManager } from './worktree';
import { broadcast, broadcastToTicket } from './websocket';

export type AgentStatus = 'idle' | 'starting' | 'running' | 'blocked' | 'completed' | 'failed';

export interface AgentJob {
  ticketId: string;
  agentId: string;
  status: AgentStatus;
  process?: Subprocess;
  startedAt?: Date;
  iterations: number;
  lastOutput?: string;
}

export interface OrchestratorConfig {
  maxIterations: number;
  timeoutMs: number;
  claudePath: string;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterations: 50,
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  claudePath: 'claude',
};

class Orchestrator {
  private config: OrchestratorConfig;
  private currentJob: AgentJob | null = null;
  private queue: string[] = []; // Queue of ticket IDs
  private isProcessing = false;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a ticket to the processing queue
   */
  async enqueue(ticketId: string): Promise<void> {
    if (this.queue.includes(ticketId)) {
      console.log(`Ticket ${ticketId} already in queue`);
      return;
    }

    this.queue.push(ticketId);
    console.log(`Ticket ${ticketId} added to queue. Queue length: ${this.queue.length}`);

    broadcast({
      type: 'queue.updated',
      payload: { queue: this.queue, currentTicketId: this.currentJob?.ticketId },
    });

    // Start processing if not already
    this.processQueue();
  }

  /**
   * Remove a ticket from the queue
   */
  dequeue(ticketId: string): void {
    this.queue = this.queue.filter((id) => id !== ticketId);
    broadcast({
      type: 'queue.updated',
      payload: { queue: this.queue, currentTicketId: this.currentJob?.ticketId },
    });
  }

  /**
   * Process the next ticket in the queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const ticketId = this.queue.shift()!;

    try {
      await this.startAgent(ticketId);
    } catch (error) {
      console.error(`Failed to start agent for ticket ${ticketId}:`, error);
      await this.updateTicketColumn(ticketId, 'blocked');
      await this.addSystemMessage(ticketId, `Agent failed to start: ${error}`);
    }

    this.isProcessing = false;

    // Process next ticket if available
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Start an agent for a ticket
   */
  async startAgent(ticketId: string): Promise<void> {
    console.log(`Starting agent for ticket ${ticketId}`);

    // Get ticket details
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    // Create agent record
    const agentId = nanoid();
    await db.insert(agents).values({
      id: agentId,
      ticketId,
      status: 'STARTING',
      iterationCount: 0,
      maxIterations: this.config.maxIterations,
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    // Initialize job
    this.currentJob = {
      ticketId,
      agentId,
      status: 'starting',
      startedAt: new Date(),
      iterations: 0,
    };

    // Broadcast agent started
    broadcast({
      type: 'agent.started',
      payload: { ticketId, agentId },
    });

    try {
      // Create worktree for agent
      const worktreeManager = getWorktreeManager();
      const worktree = await worktreeManager.create(ticketId);
      console.log(`Created worktree at ${worktree.path}`);

      await this.addSystemMessage(ticketId, `Agent started. Working in branch: ${worktree.branch}`);

      // Start the Ralph Wiggum loop
      await this.runAgentLoop(ticketId, agentId, worktree.path);
    } catch (error) {
      console.error(`Agent error for ticket ${ticketId}:`, error);
      await this.failAgent(ticketId, agentId, String(error));
    }
  }

  /**
   * Run the agent in a Ralph Wiggum loop until completion or blocked
   */
  private async runAgentLoop(ticketId: string, agentId: string, worktreePath: string): Promise<void> {
    // Get PRD content for the agent
    const prdContent = await this.getPRDContent(ticketId);
    const prompt = this.buildAgentPrompt(prdContent);

    let sessionId: string | null = null;
    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;
      this.currentJob!.iterations = iterations;

      await this.updateAgentStatus(agentId, 'running', iterations);

      broadcast({
        type: 'agent.progress',
        payload: { ticketId, agentId, iteration: iterations, maxIterations: this.config.maxIterations },
      });

      try {
        // Build claude command
        const args = [
          this.config.claudePath,
          '--print',
          '--output-format', 'stream-json',
          '--max-turns', '1', // One turn per iteration for better control
        ];

        // Resume session if we have one
        if (sessionId) {
          args.push('--resume', sessionId);
          args.push('--prompt', 'Continue working on the task. If you are done, say "TASK_COMPLETE". If you need human input, say "NEED_HUMAN_INPUT: " followed by your question.');
        } else {
          args.push('--prompt', prompt);
        }

        console.log(`Running Claude CLI iteration ${iterations} in ${worktreePath}`);

        const proc = Bun.spawn(args, {
          cwd: worktreePath,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            ...process.env,
            // Don't prompt for permissions in headless mode
            CLAUDE_CODE_HEADLESS: '1',
          },
        });

        this.currentJob!.process = proc;

        // Stream and collect output
        const output = await this.streamOutput(ticketId, proc);
        this.currentJob!.lastOutput = output;

        // Extract session ID from output for resumption
        const newSessionId = this.extractSessionId(output);
        if (newSessionId) {
          sessionId = newSessionId;
        }

        // Check for completion or blocked state
        if (this.isTaskComplete(output)) {
          await this.completeAgent(ticketId, agentId, output);
          return;
        }

        if (this.needsHumanInput(output)) {
          const question = this.extractQuestion(output);
          await this.blockAgent(ticketId, agentId, question);
          return;
        }

        // Check exit code
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          console.log(`Claude CLI exited with code ${exitCode}`);
          // Non-zero exit might mean tool use was rejected - continue loop
        }

      } catch (error) {
        console.error(`Error in agent loop iteration ${iterations}:`, error);
        await this.addSystemMessage(ticketId, `Error in iteration ${iterations}: ${error}`);
      }

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Max iterations reached
    await this.blockAgent(
      ticketId,
      agentId,
      `Reached maximum iterations (${this.config.maxIterations}). Please review progress and provide guidance.`
    );
  }

  /**
   * Stream output from Claude CLI to ticket chat
   */
  private async streamOutput(ticketId: string, proc: Subprocess<'pipe', 'pipe', 'pipe'>): Promise<string> {
    let fullOutput = '';

    // Handle stdout
    if (proc.stdout && typeof proc.stdout !== 'number') {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          fullOutput += chunk;

          // Parse JSON lines and broadcast relevant content
          for (const line of chunk.split('\n')) {
            if (!line.trim()) continue;

            try {
              const json = JSON.parse(line);

              // Broadcast assistant messages
              if (json.type === 'assistant' && json.message?.content) {
                const textContent = json.message.content
                  .filter((c: unknown) => (c as { type: string }).type === 'text')
                  .map((c: unknown) => (c as { text: string }).text)
                  .join('\n');

                if (textContent) {
                  broadcastToTicket(ticketId, {
                    type: 'agent.output',
                    payload: { ticketId, content: textContent, type: 'assistant' },
                  });
                }
              }

              // Broadcast tool use
              if (json.type === 'tool_use') {
                broadcastToTicket(ticketId, {
                  type: 'agent.output',
                  payload: { ticketId, content: `Using tool: ${json.name}`, type: 'tool' },
                });
              }

            } catch {
              // Not JSON, broadcast raw
              if (line.trim()) {
                broadcastToTicket(ticketId, {
                  type: 'agent.output',
                  payload: { ticketId, content: line, type: 'raw' },
                });
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    // Also capture stderr
    if (proc.stderr && typeof proc.stderr !== 'number') {
      const stderr = await new Response(proc.stderr).text();
      if (stderr) {
        fullOutput += '\n[STDERR]\n' + stderr;
      }
    }

    return fullOutput;
  }

  /**
   * Build the initial prompt for the agent
   */
  private buildAgentPrompt(prdContent: string): string {
    return `You are an autonomous coding agent. Your task is to implement the following PRD (Product Requirements Document):

---
${prdContent}
---

IMPORTANT INSTRUCTIONS:
1. Read and understand the PRD carefully
2. Implement the requirements step by step
3. Write tests if appropriate
4. Run tests to verify your implementation
5. When you are completely done, output exactly: "TASK_COMPLETE"
6. If you encounter a blocker or need clarification, output: "NEED_HUMAN_INPUT: " followed by your question

Start by exploring the codebase to understand the project structure, then implement the requirements.`;
  }

  /**
   * Get PRD content for a ticket
   */
  private async getPRDContent(ticketId: string): Promise<string> {
    const result = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId));

    const ticket = result[0];
    if (!ticket) {
      return 'No PRD content available';
    }

    // Join with PRD table to get content
    const { prds } = await import('./schema');
    const prdResult = await db.select().from(prds).where(eq(prds.ticketId, ticketId));
    const prd = prdResult[0];

    return prd?.content || `# ${ticket.title}\n\n${ticket.description || 'No description provided'}`;
  }

  /**
   * Extract session ID from Claude output for resumption
   */
  private extractSessionId(output: string): string | null {
    // Look for session ID in the output
    const match = output.match(/session[_-]?id["\s:]+([a-zA-Z0-9-]+)/i);
    return match?.[1] || null;
  }

  /**
   * Check if task is complete
   */
  private isTaskComplete(output: string): boolean {
    return output.includes('TASK_COMPLETE');
  }

  /**
   * Check if agent needs human input
   */
  private needsHumanInput(output: string): boolean {
    return output.includes('NEED_HUMAN_INPUT:');
  }

  /**
   * Extract question from blocked output
   */
  private extractQuestion(output: string): string {
    const match = output.match(/NEED_HUMAN_INPUT:\s*(.+)/s);
    return match?.[1]?.trim() || 'Agent needs human input';
  }

  /**
   * Complete the agent successfully
   */
  private async completeAgent(ticketId: string, agentId: string, output: string): Promise<void> {
    console.log(`Agent completed for ticket ${ticketId}`);

    await this.updateAgentStatus(agentId, 'completed');
    await this.updateTicketColumn(ticketId, 'review');
    await this.addSystemMessage(ticketId, 'Agent completed the task. Please review the changes.');

    // Clean up worktree (but keep the branch for review)
    try {
      const worktreeManager = getWorktreeManager();
      await worktreeManager.unlock(ticketId);
    } catch {
      // Ignore
    }

    broadcast({
      type: 'agent.completed',
      payload: { ticketId, agentId },
    });

    this.currentJob = null;
  }

  /**
   * Block the agent waiting for human input
   */
  private async blockAgent(ticketId: string, agentId: string, question: string): Promise<void> {
    console.log(`Agent blocked for ticket ${ticketId}: ${question}`);

    await this.updateAgentStatus(agentId, 'blocked');
    await this.updateTicketColumn(ticketId, 'blocked');
    await this.addAgentMessage(ticketId, question);

    broadcast({
      type: 'agent.blocked',
      payload: { ticketId, agentId, question },
    });

    // Don't clear currentJob - we'll resume when human responds
  }

  /**
   * Fail the agent
   */
  private async failAgent(ticketId: string, agentId: string, error: string): Promise<void> {
    console.log(`Agent failed for ticket ${ticketId}: ${error}`);

    await this.updateAgentStatus(agentId, 'failed');
    await this.updateTicketColumn(ticketId, 'blocked');
    await this.addSystemMessage(ticketId, `Agent failed: ${error}`);

    // Clean up worktree
    try {
      const worktreeManager = getWorktreeManager();
      await worktreeManager.remove(ticketId, true);
    } catch {
      // Ignore cleanup errors
    }

    broadcast({
      type: 'agent.failed',
      payload: { ticketId, agentId, error },
    });

    this.currentJob = null;
  }

  /**
   * Resume a blocked agent with human response
   */
  async resumeAgent(ticketId: string, response: string): Promise<void> {
    if (!this.currentJob || this.currentJob.ticketId !== ticketId) {
      throw new Error(`No blocked agent found for ticket ${ticketId}`);
    }

    // Save human response as message
    await this.addHumanMessage(ticketId, response);

    // Re-enqueue the ticket to continue processing
    this.currentJob = null;
    await this.enqueue(ticketId);
  }

  /**
   * Kill the current agent
   */
  async killAgent(ticketId: string): Promise<void> {
    if (!this.currentJob || this.currentJob.ticketId !== ticketId) {
      throw new Error(`No active agent found for ticket ${ticketId}`);
    }

    // Kill the process
    if (this.currentJob.process) {
      this.currentJob.process.kill();
    }

    await this.failAgent(ticketId, this.currentJob.agentId, 'Agent killed by user');
  }

  /**
   * Get current queue status
   */
  getStatus(): { queue: string[]; currentJob: AgentJob | null } {
    return {
      queue: [...this.queue],
      currentJob: this.currentJob ? { ...this.currentJob, process: undefined } : null,
    };
  }

  // Helper methods for database updates

  private async updateAgentStatus(agentId: string, status: AgentStatus, iterations?: number): Promise<void> {
    const updates: Record<string, unknown> = {
      status: status.toUpperCase(),
    };
    if (iterations !== undefined) {
      updates.iterationCount = iterations;
    }
    if (status === 'completed' || status === 'failed') {
      updates.completedAt = new Date().toISOString();
    }
    await db.update(agents).set(updates).where(eq(agents.id, agentId));
  }

  private async updateTicketColumn(ticketId: string, columnId: string): Promise<void> {
    await db.update(tickets).set({
      columnId,
      updatedAt: new Date().toISOString(),
    }).where(eq(tickets.id, ticketId));

    broadcast({
      type: 'ticket.updated',
      payload: { ticketId, columnId },
    });
  }

  private async addSystemMessage(ticketId: string, content: string): Promise<void> {
    await db.insert(messages).values({
      id: nanoid(),
      ticketId,
      content,
      senderType: 'system',
      createdAt: new Date().toISOString(),
    });

    broadcastToTicket(ticketId, {
      type: 'message.created',
      payload: { ticketId, content, senderType: 'system' },
    });
  }

  private async addAgentMessage(ticketId: string, content: string): Promise<void> {
    await db.insert(messages).values({
      id: nanoid(),
      ticketId,
      content,
      senderType: 'agent',
      createdAt: new Date().toISOString(),
    });

    broadcastToTicket(ticketId, {
      type: 'message.created',
      payload: { ticketId, content, senderType: 'agent' },
    });
  }

  private async addHumanMessage(ticketId: string, content: string): Promise<void> {
    await db.insert(messages).values({
      id: nanoid(),
      ticketId,
      content,
      senderType: 'human',
      createdAt: new Date().toISOString(),
    });

    broadcastToTicket(ticketId, {
      type: 'message.created',
      payload: { ticketId, content, senderType: 'human' },
    });
  }
}

// Singleton instance
let orchestrator: Orchestrator | null = null;

export function initOrchestrator(config?: Partial<OrchestratorConfig>): Orchestrator {
  orchestrator = new Orchestrator(config);
  return orchestrator;
}

export function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    throw new Error('Orchestrator not initialized. Call initOrchestrator first.');
  }
  return orchestrator;
}
