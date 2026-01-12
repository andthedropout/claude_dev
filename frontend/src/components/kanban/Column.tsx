import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { MoreHorizontal, Plus, Circle, Loader2, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TicketCard } from './TicketCard';
import type { Column as ColumnType, Ticket } from '@/lib/api';

interface ColumnProps {
  column: ColumnType;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
  onAddTicket: () => void;
}

// Status icons matching Linear exactly
const statusConfig: Record<string, { icon: typeof Circle; color: string; filled?: boolean }> = {
  backlog: { icon: Circle, color: '#6B6B6F' },
  ready: { icon: Circle, color: '#6B6B6F' },
  'in-progress': { icon: Loader2, color: '#F5A623', filled: true },
  blocked: { icon: XCircle, color: '#E5484D', filled: true },
  review: { icon: Eye, color: '#0091FF', filled: true },
  done: { icon: CheckCircle2, color: '#30A46C', filled: true },
};

function StatusIcon({ columnId }: { columnId: string }) {
  const config = statusConfig[columnId] || statusConfig.backlog;
  const Icon = config.icon;

  return (
    <Icon
      className="w-4 h-4"
      style={{ color: config.color }}
      strokeWidth={config.filled ? 2.5 : 1.5}
    />
  );
}

export function Column({ column, tickets, onTicketClick, onAddTicket }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      className={`flex flex-col w-[280px] shrink-0 transition-colors ${
        isOver ? 'bg-accent/20' : ''
      }`}
    >
      {/* Column Header - Linear style */}
      <div className="flex items-center gap-2 px-2 py-2 group">
        <StatusIcon columnId={column.id} />
        <span className="text-[13px] font-medium text-foreground">{column.name}</span>
        <span className="text-[13px] text-muted-foreground tabular-nums">{tickets.length}</span>

        {/* Hover actions */}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          <button
            onClick={onAddTicket}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Ticket List */}
      <ScrollArea className="flex-1">
        <div
          ref={setNodeRef}
          className="flex flex-col gap-0 min-h-[100px] px-1"
        >
          <SortableContext
            items={tickets.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                columnId={column.id}
                onClick={() => onTicketClick(ticket)}
              />
            ))}
          </SortableContext>
        </div>
      </ScrollArea>
    </div>
  );
}
