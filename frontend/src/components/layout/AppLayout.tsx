import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Bot,
  Settings,
  Sparkles,
  Play,
  Pause,
  Zap,
} from 'lucide-react';
import { getAgentStatus, type AgentStatus as AgentStatusType } from '@/lib/api';

interface AppLayoutProps {
  children: React.ReactNode;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  badge?: 'running' | 'idle';
}

function NavItem({ icon, label, count, active, onClick, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors ${
        active
          ? 'bg-sidebar-accent text-sidebar-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      }`}
    >
      <span className="w-4 h-4 flex items-center justify-center opacity-70">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {badge === 'running' && (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Running
        </span>
      )}
      {count !== undefined && !badge && (
        <span className="text-[11px] text-sidebar-foreground/40 tabular-nums">{count}</span>
      )}
    </button>
  );
}

interface AgentStatusProps {
  name: string;
  status: 'running' | 'idle' | 'queued';
  task?: string;
}

function AgentStatus({ name, status, task }: AgentStatusProps) {
  return (
    <div className="px-2 py-1.5 rounded hover:bg-sidebar-accent/30 transition-colors cursor-pointer">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          status === 'running' ? 'bg-emerald-400 animate-pulse' :
          status === 'queued' ? 'bg-amber-400' : 'bg-sidebar-foreground/20'
        }`} />
        <span className="text-[12px] text-sidebar-foreground/80 flex-1">{name}</span>
        {status === 'running' && <Play className="w-3 h-3 text-emerald-400" />}
        {status === 'queued' && <Pause className="w-3 h-3 text-amber-400" />}
      </div>
      {task && status === 'running' && (
        <p className="text-[10px] text-sidebar-foreground/40 mt-0.5 ml-4 truncate">{task}</p>
      )}
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const [activeItem, setActiveItem] = useState('board');
  const [agentStatus, setAgentStatus] = useState<AgentStatusType | null>(null);

  // Poll for agent status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getAgentStatus();
        setAgentStatus(status);
      } catch (e) {
        console.error('Failed to fetch agent status:', e);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Build agent list from status
  const agents: { name: string; status: 'running' | 'idle' | 'queued'; task?: string }[] = [];

  if (agentStatus?.currentJob) {
    agents.push({
      name: `Ticket ${agentStatus.currentJob.ticketId.slice(0, 8)}`,
      status: 'running',
      task: `Iteration ${agentStatus.currentJob.iterations}`,
    });
  }

  for (const ticketId of agentStatus?.queue || []) {
    agents.push({
      name: `Ticket ${ticketId.slice(0, 8)}`,
      status: 'queued',
    });
  }

  const runningCount = agentStatus?.currentJob ? 1 : 0;
  const queuedCount = agentStatus?.queue?.length || 0;

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-[220px] flex flex-col bg-sidebar border-r border-sidebar-border shrink-0">
        {/* Header */}
        <div className="h-12 flex items-center px-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[14px] font-semibold text-sidebar-foreground">PRD Manager</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-3">
          {/* Main Nav */}
          <div className="px-2 space-y-0.5">
            <NavItem
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Board"
              onClick={() => setActiveItem('board')}
              active={activeItem === 'board'}
            />
            <NavItem
              icon={<Bot className="w-4 h-4" />}
              label="Agents"
              onClick={() => setActiveItem('agents')}
              active={activeItem === 'agents'}
              badge={runningCount > 0 ? 'running' : undefined}
            />
          </div>

          {/* Agent Status Section */}
          <div className="mt-6 px-2">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
                Agent Status
              </span>
              {runningCount > 0 && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {runningCount} active
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              {agents.map((agent, i) => (
                <AgentStatus key={i} {...agent} />
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="mt-6 px-2">
            <div className="px-2 mb-2">
              <span className="text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
                Queue
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 px-2">
              <div className="bg-sidebar-accent/30 rounded-lg p-2.5">
                <div className="text-[18px] font-semibold text-sidebar-foreground">{queuedCount}</div>
                <div className="text-[10px] text-sidebar-foreground/50">Queued</div>
              </div>
              <div className="bg-sidebar-accent/30 rounded-lg p-2.5">
                <div className="text-[18px] font-semibold text-emerald-400">{runningCount}</div>
                <div className="text-[10px] text-sidebar-foreground/50">Running</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-2">
          <NavItem
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
            onClick={() => setActiveItem('settings')}
            active={activeItem === 'settings'}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
