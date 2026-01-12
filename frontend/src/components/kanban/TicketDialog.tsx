import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { X, Trash2, Circle, Loader2, Eye, CheckCircle2, XCircle, Save, RotateCcw, MessageSquare, Terminal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useKanbanStore } from '@/stores/kanban-store';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TerminalView } from '@/components/terminal/TerminalView';
import { startTerminal } from '@/lib/api';
import type { TicketWithDetails } from '@/lib/api';

type ViewTab = 'terminal' | 'chat';

interface TicketDialogProps {
  ticket: TicketWithDetails | null;
  onClose: () => void;
}

const statusConfig: Record<string, { icon: typeof Circle; color: string; label: string }> = {
  backlog: { icon: Circle, color: '#6B6B6F', label: 'Backlog' },
  ready: { icon: Circle, color: '#6B6B6F', label: 'Ready' },
  'in-progress': { icon: Loader2, color: '#F5A623', label: 'In Progress' },
  blocked: { icon: XCircle, color: '#E5484D', label: 'Blocked' },
  review: { icon: Eye, color: '#0091FF', label: 'Review' },
  done: { icon: CheckCircle2, color: '#30A46C', label: 'Done' },
};

function StatusBadge({ columnId }: { columnId: string }) {
  const config = statusConfig[columnId] || statusConfig.backlog;
  const Icon = config.icon;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded font-medium"
      style={{ backgroundColor: `${config.color}20`, color: config.color }}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

export function TicketDialog({ ticket, onClose }: TicketDialogProps) {
  const { updatePRD, addMessage, deleteTicket } = useKanbanStore();
  const [prdContent, setPrdContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('terminal');

  useEffect(() => {
    if (ticket?.prd?.content) {
      setPrdContent(ticket.prd.content);
    } else {
      setPrdContent('');
    }
  }, [ticket?.prd?.content, ticket?.id]);

  // Auto-start terminal when dialog opens
  useEffect(() => {
    if (!ticket) return;
    startTerminal(ticket.id).catch((e) => {
      console.log('Terminal start:', e.message);
    });
  }, [ticket?.id]);

  const handleSavePRD = async () => {
    if (ticket) {
      await updatePRD(ticket.id, prdContent);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (ticket) {
      setIsLoading(true);
      try {
        await addMessage(ticket.id, content);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDelete = async () => {
    if (ticket && confirm('Are you sure you want to delete this issue?')) {
      await deleteTicket(ticket.id);
      onClose();
    }
  };

  if (!ticket) return null;

  const hasChanges = prdContent !== (ticket.prd?.content || '');
  const shortId = `PRD-${ticket.id.slice(0, 3).toUpperCase()}`;

  const chatMessages = (ticket.messages || []).map(msg => ({
    id: msg.id,
    content: msg.content,
    senderType: msg.senderType as 'human' | 'agent' | 'system',
    createdAt: msg.createdAt,
  }));

  return (
    <Dialog open={!!ticket} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="!max-w-[95vw] !w-[1400px] !h-[90vh] !flex !flex-col !p-0 !gap-0 overflow-hidden border-border bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-3 min-w-0">
            {/* Tab buttons on left */}
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => setActiveTab('terminal')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-colors ${
                  activeTab === 'terminal'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                Terminal
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-colors ${
                  activeTab === 'chat'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Chat + PRD
              </button>
            </div>
            <div className="w-px h-4 bg-border" />
            <span className="text-[12px] font-mono text-muted-foreground">{shortId}</span>
            <div className="w-px h-4 bg-border" />
            <StatusBadge columnId={ticket.columnId} />
            <div className="w-px h-4 bg-border" />
            <h2 className="text-[14px] font-medium text-foreground truncate">{ticket.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content - both views always mounted, just hidden */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          {/* Terminal View - Full width */}
          <div className={`absolute inset-0 ${activeTab !== 'terminal' ? 'invisible' : ''}`}>
            <TerminalView
              ticketId={ticket.id}
              sessionId={ticket.sessionId}
            />
          </div>

          {/* Chat + PRD View - 2 columns */}
          <div className={`absolute inset-0 flex ${activeTab !== 'chat' ? 'invisible' : ''}`}>
            {/* Left: Chat */}
            <div className="w-[420px] h-full shrink-0 border-r border-border flex flex-col bg-card/30">
              <ChatPanel
                messages={chatMessages}
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
                placeholder="Send message to terminal..."
              />
            </div>

            {/* Right: PRD Editor */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div>
                  <h3 className="text-[12px] font-medium text-foreground/80">Document</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {hasChanges ? (
                      <span className="text-amber-500">Unsaved changes</span>
                    ) : (
                      'All changes saved'
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrdContent(ticket.prd?.content || '')}
                    disabled={!hasChanges}
                    className="h-7 text-[11px]"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSavePRD}
                    disabled={!hasChanges}
                    className="h-7 text-[11px]"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                <Editor
                  height="100%"
                  defaultLanguage="markdown"
                  value={prdContent}
                  onChange={(value) => setPrdContent(value || '')}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    lineNumbers: 'off',
                    fontSize: 14,
                    fontFamily: '"Inter", system-ui, sans-serif',
                    padding: { top: 20, bottom: 20 },
                    scrollBeyondLastLine: false,
                    renderLineHighlight: 'none',
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    cursorBlinking: 'smooth',
                    smoothScrolling: true,
                    lineHeight: 1.6,
                    scrollbar: {
                      vertical: 'auto',
                      horizontal: 'hidden',
                      verticalScrollbarSize: 8,
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
