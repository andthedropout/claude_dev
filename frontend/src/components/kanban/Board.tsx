import { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Filter, SlidersHorizontal, Circle, Loader, Archive } from 'lucide-react';
import { useKanbanStore } from '@/stores/kanban-store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Column } from './Column';
import { TicketCard } from './TicketCard';
import { TicketDialog } from './TicketDialog';
import { CreateTicketDialog } from './CreateTicketDialog';
import type { Ticket, Message } from '@/lib/api';

const filterTabs = [
  { id: 'all', label: 'All issues', icon: Circle },
  { id: 'active', label: 'Active', icon: Loader },
  { id: 'backlog', label: 'Backlog', icon: Archive },
];

export function Board() {
  const {
    columns,
    tickets,
    selectedTicket,
    fetchColumns,
    fetchTickets,
    selectTicket,
    moveTicket,
    createTicket,
  } = useKanbanStore();

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [createColumnId, setCreateColumnId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const handleWebSocketMessage = useCallback((message: { type: string; payload?: unknown }) => {
    if (message.type === 'message.created') {
      const msg = message.payload as Message;
      if (selectedTicket && msg.ticketId === selectedTicket.id) {
        selectTicket(selectedTicket.id);
      }
    } else if (message.type === 'ticket.updated') {
      fetchTickets();
    } else if (message.type === 'agent.output') {
      // Agent output is streamed - refresh ticket to see new messages
      const payload = message.payload as { ticketId: string };
      if (selectedTicket && payload.ticketId === selectedTicket.id) {
        selectTicket(selectedTicket.id);
      }
    } else if (message.type === 'agent.completed' || message.type === 'agent.failed' || message.type === 'agent.blocked') {
      // Agent state changed - refresh tickets to see column changes
      fetchTickets();
      const payload = message.payload as { ticketId: string };
      if (selectedTicket && payload.ticketId === selectedTicket.id) {
        selectTicket(selectedTicket.id);
      }
    }
  }, [selectedTicket, selectTicket, fetchTickets]);

  const { subscribe, unsubscribe } = useWebSocket(handleWebSocketMessage);

  useEffect(() => {
    if (selectedTicket) {
      subscribe(selectedTicket.id);
      return () => unsubscribe(selectedTicket.id);
    }
  }, [selectedTicket?.id, subscribe, unsubscribe]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  useEffect(() => {
    fetchColumns();
    fetchTickets();
  }, [fetchColumns, fetchTickets]);

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = tickets.find((t) => t.id === event.active.id);
    if (ticket) setActiveTicket(ticket);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTicket(null);

    const { active, over } = event;
    if (!over) return;

    const ticketId = active.id as string;
    const overId = over.id as string;

    const targetColumn = columns.find((c) => c.id === overId);
    if (targetColumn) {
      const columnTickets = tickets.filter((t) => t.columnId === targetColumn.id);
      moveTicket(ticketId, targetColumn.id, columnTickets.length);
      return;
    }

    const overTicket = tickets.find((t) => t.id === overId);
    if (overTicket) {
      const columnTickets = tickets
        .filter((t) => t.columnId === overTicket.columnId)
        .sort((a, b) => a.position - b.position);

      const overIndex = columnTickets.findIndex((t) => t.id === overId);
      moveTicket(ticketId, overTicket.columnId, overIndex);
    }
  };

  const handleTicketClick = (ticket: Ticket) => {
    selectTicket(ticket.id);
  };

  const handleAddTicket = (columnId: string) => {
    setCreateColumnId(columnId);
  };

  const handleCreateTicket = async (title: string) => {
    if (createColumnId) {
      await createTicket(title, createColumnId);
      setCreateColumnId(null);
    }
  };

  const getColumnTickets = (columnId: string) =>
    tickets
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Filter Tabs Bar - Linear style */}
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-4 h-11">
          {/* Left side - Filter tabs */}
          <div className="flex items-center gap-1">
            {filterTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilter(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] transition-colors ${
                    activeFilter === tab.id
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right side - Filter & Display */}
          <div className="flex items-center gap-1">
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
              <Filter className="w-3.5 h-3.5" />
              <span>Filter</span>
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Display</span>
            </button>
          </div>
        </div>
      </header>

      {/* Board Content */}
      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 h-full">
            {columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                tickets={getColumnTickets(column.id)}
                onTicketClick={handleTicketClick}
                onAddTicket={() => handleAddTicket(column.id)}
              />
            ))}
          </div>

          <DragOverlay>
            {activeTicket ? (
              <div className="opacity-90">
                <TicketCard ticket={activeTicket} columnId={activeTicket.columnId} onClick={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <TicketDialog
        ticket={selectedTicket}
        onClose={() => selectTicket(null)}
      />

      <CreateTicketDialog
        open={createColumnId !== null}
        onClose={() => setCreateColumnId(null)}
        onCreate={handleCreateTicket}
      />
    </div>
  );
}
