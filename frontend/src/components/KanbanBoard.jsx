import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Pencil, Trash2, GripVertical } from 'lucide-react';

const STAGES = ['Screening', 'Due Diligence', 'Invested', 'Passed', 'Lost', 'On Hold', 'Tracking'];

const STAGE_HEADER = {
  Screening:       'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',
  'Due Diligence': 'bg-violet-500/15 text-violet-400 border border-violet-500/25',
  Invested:        'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  Passed:          'bg-red-500/15 text-red-400 border border-red-500/25',
  Lost:            'bg-rose-500/15 text-rose-400 border border-rose-500/25',
  'On Hold':       'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  Tracking:        'bg-sky-500/15 text-sky-400 border border-sky-500/25',
};

const STAGE_DROP_OVER = {
  Screening:       'bg-cyan-500/10 ring-1 ring-cyan-500/30',
  'Due Diligence': 'bg-violet-500/10 ring-1 ring-violet-500/30',
  Invested:        'bg-emerald-500/10 ring-1 ring-emerald-500/30',
  Passed:          'bg-red-500/10 ring-1 ring-red-500/30',
  Lost:            'bg-rose-500/10 ring-1 ring-rose-500/30',
  'On Hold':       'bg-amber-500/10 ring-1 ring-amber-500/30',
  Tracking:        'bg-sky-500/10 ring-1 ring-sky-500/30',
};


function DealCard({ deal, onEdit, onDelete, isDragging = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging: dragging } = useDraggable({
    id: String(deal.id),
    data: { deal },
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-xl border bg-ob-800 p-3.5 transition ${
        dragging
          ? 'opacity-40 border-ob-600'
          : 'border-ob-600 hover:border-ob-400 hover:shadow-md hover:shadow-black/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate font-semibold text-ob-50 text-sm">{deal.company_name}</p>
          {deal.sector && (
            <p className="mt-0.5 text-xs text-ob-500">{deal.sector}{deal.location ? ` · ${deal.location}` : ''}</p>
          )}
          {deal.funding_ask && (
            <p className="mt-1 text-xs font-medium text-ob-300">{deal.funding_ask}</p>
          )}
          {deal.founders?.length > 0 && (
            <p className="mt-1 truncate text-xs text-ob-500">{deal.founders.slice(0, 2).join(', ')}</p>
          )}
        </div>
        <div
          {...listeners}
          {...attributes}
          className="cursor-grab text-ob-600 hover:text-ob-400 flex-shrink-0 transition"
        >
          <GripVertical size={14} />
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 bottom-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(deal); }}
          className="rounded p-1 text-ob-500 hover:bg-ob-600 hover:text-ob-100 transition"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }}
          className="rounded p-1 text-ob-500 hover:bg-red-500/10 hover:text-red-400 transition"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function Column({ stage, deals, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-64 flex-shrink-0 flex-col">
      <div className={`mb-3 flex items-center justify-between rounded-lg px-3 py-2 ${STAGE_HEADER[stage]}`}>
        <span className="text-xs font-semibold">{stage}</span>
        <span className="rounded-full bg-ob-900/60 px-2 py-0.5 text-xs font-bold text-ob-300">
          {deals.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2.5 rounded-xl p-2 transition min-h-[120px] ${
          isOver ? STAGE_DROP_OVER[stage] : 'bg-ob-900/40'
        }`}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard({ deals, onStageChange, onEdit, onDelete }) {
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const activeDeal = activeId ? deals.find((d) => String(d.id) === activeId) : null;

  const dealsByStage = STAGES.reduce((acc, s) => {
    acc[s] = deals.filter((d) => d.stage === s);
    return acc;
  }, {});

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    const newStage = over.id;
    const deal = deals.find((d) => String(d.id) === String(active.id));
    if (deal && STAGES.includes(newStage) && deal.stage !== newStage) {
      onStageChange(deal.id, newStage);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
        {STAGES.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            deals={dealsByStage[stage]}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>

      <DragOverlay>
        {activeDeal && (
          <div className="w-64 rounded-xl border border-cyan-500/40 bg-ob-800 p-3.5 shadow-2xl shadow-black/50 ring-1 ring-cyan-500/20">
            <p className="font-semibold text-ob-50 text-sm">{activeDeal.company_name}</p>
            {activeDeal.sector && (
              <p className="mt-0.5 text-xs text-ob-500">{activeDeal.sector}</p>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
