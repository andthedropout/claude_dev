import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Circle, Loader2, Eye, CheckCircle2, XCircle, Trash2, BarChart3 } from 'lucide-react';
import { useKanbanStore } from '@/stores/kanban-store';
import type { Ticket } from '@/lib/api';

interface TicketCardProps {
  ticket: Ticket;
  columnId: string;
  onClick: () => void;
}

// Status icons matching Linear
const statusConfig: Record<string, { icon: typeof Circle; color: string }> = {
  backlog: { icon: Circle, color: '#6B6B6F' },
  ready: { icon: Circle, color: '#6B6B6F' },
  'in-progress': { icon: Loader2, color: '#F5A623' },
  blocked: { icon: XCircle, color: '#E5484D' },
  review: { icon: Eye, color: '#0091FF' },
  done: { icon: CheckCircle2, color: '#30A46C' },
};

// Generate a consistent color from ticket ID for avatar
function getAvatarColor(id: string): string {
  const colors = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  ];
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function StatusIcon({ columnId }: { columnId: string }) {
  const config = statusConfig[columnId] || statusConfig.backlog;
  const Icon = config.icon;
  return (
    <Icon
      className="w-3.5 h-3.5 shrink-0"
      style={{ color: config.color }}
      strokeWidth={1.5}
    />
  );
}

export function TicketCard({ ticket, columnId, onClick }: TicketCardProps) {
  const deleteTicket = useKanbanStore((state) => state.deleteTicket);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  const shortId = `PRD-${ticket.id.slice(0, 3).toUpperCase()}`;
  const avatarColor = getAvatarColor(ticket.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="group relative cursor-pointer bg-card hover:bg-accent/40 border border-transparent hover:border-border rounded-md p-2.5 transition-all"
    >
      {/* Top row: ID and Avatar */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground font-mono">
          {shortId}
        </span>
        <div className={`w-5 h-5 rounded-full ${avatarColor} flex items-center justify-center`}>
          <span className="text-[9px] font-medium text-white">
            {ticket.title.charAt(0).toUpperCase()}
          </span>
        </div>
      </div>

      {/* Title row with status */}
      <div className="flex items-start gap-2">
        <StatusIcon columnId={columnId} />
        <span className="text-[13px] text-foreground leading-snug line-clamp-2 flex-1">
          {ticket.title}
        </span>
      </div>

      {/* Bottom row: indicators */}
      <div className="flex items-center justify-between mt-2">
        <BarChart3 className="w-3.5 h-3.5 text-muted-foreground/40" />

        <button
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete this ticket?')) {
              deleteTicket(ticket.id);
            }
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
