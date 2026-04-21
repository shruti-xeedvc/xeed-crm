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

const STAGES = ['Sourcing', 'Screening', 'Diligence', 'Term Sheet', 'Invested', 'Passed'];

const STAGE_HEADER = {
  Sourcing: 'bg-slate-100 text-slate-600',
  Screening: 'bg-blue-100 text-blue-700',
  Diligence: 'bg-purple-100 text-purple-700',
  'Term Sheet': 'bg-orange-100 text-orange-700',
  Invested: 'bg-green-100 text-green-700',
  Passed: 'bg-red-100 text-red-600',
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
      className={`group relative rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition ${
        dragging ? 'opacity-40' : 'hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate font-semibold text-slate-800 text-sm">{deal.company_name}</p>
          {deal.sector && (
            <p className="mt-0.5 text-xs text-slate-400">{deal.sector}{deal.location ? ` · ${deal.location}` : ''}</p>
          )}
          {deal.funding_ask && (
            <p className="mt-1 text-xs font-medium text-slate-600">{deal.funding_ask}</p>
          )}
          {deal.founders?.length > 0 && (
            <p className="mt-1 truncate text-xs text-slate-400">{deal.founders.slice(0, 2).join(', ')}</p>
          )}
        </div>
        <div
          {...listeners}
          {...attributes}
          className="cursor-grab text-slate-300 hover:text-slate-500 flex-shrink-0"
        >
          <GripVertical size={14} />
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 bottom-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(deal); }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }}
          className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
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
        <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold">
          {deals.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2.5 rounded-xl p-2 transition min-h-[120px] ${
          isOver ? 'bg-brand-50 ring-2 ring-brand-200' : 'bg-slate-100/60'
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
          <div className="w-64 rounded-xl border border-brand-300 bg-white p-3.5 shadow-2xl ring-2 ring-brand-200">
            <p className="font-semibold text-slate-800 text-sm">{activeDeal.company_name}</p>
            {activeDeal.sector && (
              <p className="mt-0.5 text-xs text-slate-400">{activeDeal.sector}</p>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
