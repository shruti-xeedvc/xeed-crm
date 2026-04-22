import { useState } from 'react';
import { format } from 'date-fns';
import { Pencil, Trash2, ChevronUp, ChevronDown, ExternalLink, ChevronRight } from 'lucide-react';

const STAGE_COLORS = {
  Screening:       'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',
  'Due Diligence': 'bg-violet-500/15 text-violet-400 border border-violet-500/25',
  Invested:        'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  Passed:          'bg-red-500/15 text-red-400 border border-red-500/25',
  Lost:            'bg-rose-500/15 text-rose-400 border border-rose-500/25',
  'On Hold':       'bg-amber-500/15 text-amber-400 border border-amber-500/25',
};

const Badge = ({ label, colorClass }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
    {label}
  </span>
);

const isUrl = (str) => {
  try { return Boolean(new URL(str)); } catch { return false; }
};

// ── Mobile card ────────────────────────────────────────────────
function DealCard({ deal, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-ob-600 bg-ob-800 p-4 shadow-sm hover:border-ob-400 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ob-50">{deal.company_name}</span>
            {deal.brand && <span className="text-xs text-ob-500">{deal.brand}</span>}
            <Badge label={deal.stage} colorClass={STAGE_COLORS[deal.stage] || 'bg-ob-700 text-ob-300 border border-ob-600'} />
          </div>
          {deal.founders?.length > 0 && (
            <p className="mt-1 text-sm text-ob-400 truncate">{deal.founders.join(', ')}</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ob-500">
            {deal.sector && <span>{deal.sector}</span>}
            {deal.location && <span>{deal.location}</span>}
            {deal.funding_ask && <span className="font-medium text-ob-300">{deal.funding_ask}</span>}
            {deal.poc && <span>POC: {deal.poc}</span>}
            {deal.date_added && <span>{format(new Date(deal.date_added), 'MMM d, yyyy')}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onEdit(deal)} className="rounded p-1.5 text-ob-500 hover:bg-ob-700 hover:text-ob-100 transition">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(deal.id)} className="rounded p-1.5 text-ob-500 hover:bg-red-500/10 hover:text-red-400 transition">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {(deal.description || deal.notes || deal.deck_link || deal.founder_background) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs text-cyan-500 hover:text-cyan-400 transition"
        >
          <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          {expanded ? 'Less' : 'More details'}
        </button>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-ob-600 pt-3 text-sm">
          {deal.description && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ob-500">Description</div>
              <p className="mt-0.5 text-ob-300">{deal.description}</p>
            </div>
          )}
          {deal.founder_background && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ob-500">Founder Background</div>
              {isUrl(deal.founder_background)
                ? <a href={deal.founder_background} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex items-center gap-1 text-cyan-400 hover:underline">LinkedIn <ExternalLink size={10} /></a>
                : <p className="mt-0.5 text-ob-300">{deal.founder_background}</p>}
            </div>
          )}
          {deal.notes && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ob-500">Notes</div>
              <p className="mt-0.5 text-ob-300">{deal.notes}</p>
            </div>
          )}
          {deal.deck_link && (
            <a href={deal.deck_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-cyan-400 hover:underline">
              Open Pitch Deck <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Desktop table ──────────────────────────────────────────────
export default function DealTable({ deals, loading, onEdit, onDelete }) {
  const [sortKey, setSortKey] = useState('date_added');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState(null);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleExpand = (id) => setExpanded((prev) => (prev === id ? null : id));

  const sorted = [...deals].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={12} className="text-ob-600" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-cyan-400" />
      : <ChevronDown size={12} className="text-cyan-400" />;
  };

  const Th = ({ label, col, className = '' }) => (
    <th
      onClick={() => col && toggleSort(col)}
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ob-400 ${col ? 'cursor-pointer select-none hover:text-ob-100' : ''} ${className}`}
    >
      <span className="flex items-center gap-1">
        {label}
        {col && <SortIcon col={col} />}
      </span>
    </th>
  );

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-ob-600 bg-ob-800">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ob-600 border-t-cyan-400" />
      </div>
    );
  }

  if (!deals.length) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-ob-600 bg-ob-800/50 text-ob-500">
        <p className="text-sm font-medium">No deals found</p>
        <p className="mt-1 text-xs">Add a deal or adjust your filters</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: card list */}
      <div className="flex flex-col gap-3 md:hidden">
        {sorted.map((deal) => (
          <DealCard key={deal.id} deal={deal} onEdit={onEdit} onDelete={onDelete} />
        ))}
        <p className="text-center text-xs text-ob-500">{deals.length} deal{deals.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-ob-600 bg-ob-800">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1200px] border-collapse text-sm">
            <thead className="border-b border-ob-600 bg-ob-900/60">
              <tr>
                <Th label="" className="w-8" />
                <Th label="Company" col="company_name" />
                <Th label="Founders" />
                <Th label="Sector" col="sector" />
                <Th label="Location" />
                <Th label="Ask" col="funding_ask" />
                <Th label="POC" col="poc" />
                <Th label="Stage" col="stage" />
                <Th label="Added" col="date_added" />
                <Th label="" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ob-700">
              {sorted.map((deal) => (
                <>
                  <tr
                    key={deal.id}
                    className="group hover:bg-ob-700/40 cursor-pointer transition"
                    onClick={() => toggleExpand(deal.id)}
                  >
                    <td className="px-3 py-3 text-ob-600">
                      <ChevronRight
                        size={14}
                        className={`transition-transform ${expanded === deal.id ? 'rotate-90 text-cyan-400' : ''}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ob-50">{deal.company_name}</div>
                      {deal.brand && <div className="text-xs text-ob-500">{deal.brand}</div>}
                    </td>
                    <td className="max-w-[160px] px-4 py-3 text-ob-400">
                      <div className="truncate">{deal.founders?.length ? deal.founders.join(', ') : '—'}</div>
                      {deal.founder_background && (
                        isUrl(deal.founder_background)
                          ? <a href={deal.founder_background} target="_blank" rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-0.5 text-xs text-cyan-400 hover:underline">
                              LinkedIn <ExternalLink size={10} />
                            </a>
                          : <div className="truncate text-xs text-ob-500">{deal.founder_background}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ob-300">{deal.sector || '—'}</td>
                    <td className="px-4 py-3 text-ob-400">{deal.location || '—'}</td>
                    <td className="px-4 py-3 font-medium text-ob-100">{deal.funding_ask || '—'}</td>
                    <td className="px-4 py-3 text-ob-300">{deal.poc || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge label={deal.stage} colorClass={STAGE_COLORS[deal.stage] || 'bg-ob-700 text-ob-300 border border-ob-600'} />
                    </td>
                    <td className="px-4 py-3 text-ob-500">
                      {deal.date_added ? format(new Date(deal.date_added), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={() => onEdit(deal)}
                          className="rounded p-1 text-ob-500 hover:bg-ob-600 hover:text-ob-100 transition"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => onDelete(deal.id)}
                          className="rounded p-1 text-ob-500 hover:bg-red-500/10 hover:text-red-400 transition"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {expanded === deal.id && (
                    <tr key={`${deal.id}-expanded`} className="bg-ob-900/60">
                      <td colSpan={10} className="px-8 py-4">
                        <div className="grid grid-cols-3 gap-6 text-sm">
                          {deal.description && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ob-500">Description</div>
                              <p className="text-ob-300">{deal.description}</p>
                            </div>
                          )}
                          {deal.notes && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ob-500">Analyst Notes</div>
                              <p className="text-ob-300">{deal.notes}</p>
                            </div>
                          )}
                          {deal.deck_link && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ob-500">Pitch Deck</div>
                              <a
                                href={deal.deck_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 font-medium text-cyan-400 hover:underline"
                              >
                                Open Deck <ExternalLink size={12} />
                              </a>
                            </div>
                          )}
                          {!deal.description && !deal.notes && !deal.deck_link && (
                            <div className="col-span-3 text-ob-500">No additional details available.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-ob-700 px-4 py-2 text-xs text-ob-500">
          {deals.length} deal{deals.length !== 1 ? 's' : ''} — click a row to expand details
        </div>
      </div>
    </>
  );
}
