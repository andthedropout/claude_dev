import simpleGit, { type SimpleGit } from 'simple-git';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  locked: boolean;
  ticketId?: string;
}

export interface WorktreeManagerConfig {
  repoPath: string;
  worktreesDir: string;
}

export class WorktreeManager {
  private git: SimpleGit;
  private repoPath: string;
  private worktreesDir: string;

  constructor(config: WorktreeManagerConfig) {
    this.repoPath = resolve(config.repoPath);
    this.worktreesDir = resolve(config.worktreesDir);
    this.git = simpleGit(this.repoPath);

    // Ensure worktrees directory exists
    if (!existsSync(this.worktreesDir)) {
      mkdirSync(this.worktreesDir, { recursive: true });
    }
  }

  /**
   * Create a new worktree for a ticket
   */
  async create(ticketId: string, baseBranch: string = 'main'): Promise<Worktree> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);
    const branchName = `ticket/${ticketId}`;

    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      throw new Error(`Worktree already exists for ticket ${ticketId}`);
    }

    try {
      // Fetch latest from origin
      await this.git.fetch('origin', baseBranch);

      // Create worktree with new branch based on origin/baseBranch
      await this.git.raw([
        'worktree',
        'add',
        '-b',
        branchName,
        worktreePath,
        `origin/${baseBranch}`,
      ]);

      // Lock the worktree to prevent accidental removal
      await this.lock(ticketId, `Agent working on ticket ${ticketId}`);

      return {
        path: worktreePath,
        branch: branchName,
        head: await this.getHead(worktreePath),
        locked: true,
        ticketId,
      };
    } catch (error) {
      // Clean up on failure
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * List all worktrees
   */
  async list(): Promise<Worktree[]> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> = {};

    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as Worktree);
        }
        current = { path: line.substring(9), locked: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).replace('refs/heads/', '');
      } else if (line === 'locked') {
        current.locked = true;
      }
    }

    if (current.path) {
      worktrees.push(current as Worktree);
    }

    // Filter to only our ticket worktrees and extract ticketId
    return worktrees
      .filter((w) => w.path.includes('ticket-'))
      .map((w) => ({
        ...w,
        ticketId: w.path.match(/ticket-([^/]+)$/)?.[1],
      }));
  }

  /**
   * Get a specific worktree by ticket ID
   */
  async get(ticketId: string): Promise<Worktree | null> {
    const worktrees = await this.list();
    return worktrees.find((w) => w.ticketId === ticketId) || null;
  }

  /**
   * Lock a worktree to prevent removal
   */
  async lock(ticketId: string, reason?: string): Promise<void> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);
    const args = ['worktree', 'lock', worktreePath];
    if (reason) {
      args.push('--reason', reason);
    }
    await this.git.raw(args);
  }

  /**
   * Unlock a worktree
   */
  async unlock(ticketId: string): Promise<void> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);
    await this.git.raw(['worktree', 'unlock', worktreePath]);
  }

  /**
   * Remove a worktree and its branch
   */
  async remove(ticketId: string, force: boolean = false): Promise<void> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);
    const branchName = `ticket/${ticketId}`;

    // Unlock first if locked
    try {
      await this.unlock(ticketId);
    } catch {
      // Ignore if not locked
    }

    // Remove worktree
    const args = ['worktree', 'remove', worktreePath];
    if (force) {
      args.push('--force');
    }
    await this.git.raw(args);

    // Delete the branch
    try {
      await this.git.deleteLocalBranch(branchName, force);
    } catch {
      // Ignore if branch doesn't exist
    }
  }

  /**
   * Get the HEAD commit of a worktree
   */
  private async getHead(worktreePath: string): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);
    const log = await worktreeGit.log({ maxCount: 1 });
    return log.latest?.hash || '';
  }

  /**
   * Run a command in a worktree context
   */
  async runInWorktree(ticketId: string, command: string[]): Promise<{ stdout: string; stderr: string }> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree not found for ticket ${ticketId}`);
    }

    const proc = Bun.spawn(command, {
      cwd: worktreePath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    await proc.exited;

    return { stdout, stderr };
  }

  /**
   * Create a commit in a worktree
   */
  async commit(ticketId: string, message: string): Promise<string> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);
    const worktreeGit = simpleGit(worktreePath);

    await worktreeGit.add('.');
    const result = await worktreeGit.commit(message);
    return result.commit;
  }

  /**
   * Push changes from a worktree
   */
  async push(ticketId: string): Promise<void> {
    const worktreePath = join(this.worktreesDir, `ticket-${ticketId}`);
    const branchName = `ticket/${ticketId}`;
    const worktreeGit = simpleGit(worktreePath);

    await worktreeGit.push('origin', branchName, ['--set-upstream']);
  }
}

// Singleton instance - will be configured on startup
let worktreeManager: WorktreeManager | null = null;

export function initWorktreeManager(config: WorktreeManagerConfig): WorktreeManager {
  worktreeManager = new WorktreeManager(config);
  return worktreeManager;
}

export function getWorktreeManager(): WorktreeManager {
  if (!worktreeManager) {
    throw new Error('WorktreeManager not initialized. Call initWorktreeManager first.');
  }
  return worktreeManager;
}
