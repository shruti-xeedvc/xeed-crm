import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DealTable from '../components/DealTable';
import DealModal from '../components/DealModal';
import api from '../services/api';

const STAGES = ['Screening', 'Due Diligence', 'Invested', 'Passed', 'Lost', 'On Hold', 'Tracking'];
const SECTORS = ['Fintech', 'SaaS', 'HealthTech', 'EdTech', 'DeepTech', 'Consumer', 'Logistics', 'CleanTech', 'Other'];

const STAGE_ACCENT = {
  Screening:       'border-cyan-500/40 text-cyan-400',
  'Due Diligence': 'border-violet-500/40 text-violet-400',
  Invested:        'border-emerald-500/40 text-emerald-400',
  Passed:          'border-red-500/40 text-red-400',
  Lost:            'border-rose-500/40 text-rose-400',
  'On Hold':       'border-amber-500/40 text-amber-400',
  Tracking:        'border-sky-500/40 text-sky-400',
};

const STAGE_ACTIVE = {
  Screening:       'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/30',
  'Due Diligence': 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30',
  Invested:        'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30',
  Passed:          'border-red-500 bg-red-500/10 ring-1 ring-red-500/30',
  Lost:            'border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/30',
  'On Hold':       'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30',
  Tracking:        'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/30',
};

export default function Dashboard() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState(null);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [searchParams] = useSearchParams();

  const [filters, setFilters] = useState({ stage: '', sector: '', search: '' });
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await api.get('/deals', { params });
      setDeals(data);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  useEffect(() => {
    api.get('/gmail/status').then(({ data }) => setGmailStatus(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const gmailParam = searchParams.get('gmail');
    if (gmailParam === 'connected') {
      api.get('/gmail/status').then(({ data }) => setGmailStatus(data)).catch(() => {});
    }
  }, [searchParams]);

  const openNew = () => { setEditingDeal(null); setModalOpen(true); };
  const openEdit = (deal) => { setEditingDeal(deal); setModalOpen(true); };

  const handleSave = async (data) => {
    if (editingDeal) {
      await api.put(`/deals/${editingDeal.id}`, data);
    } else {
      await api.post('/deals', data);
    }
    setModalOpen(false);
    fetchDeals();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this deal?')) return;
    await api.delete(`/deals/${id}`);
    fetchDeals();
  };

  const connectGmail = async () => {
    const { data } = await api.get('/gmail/auth-url');
    window.location.href = data.url;
  };

  const reauth = async () => {
    if (!window.confirm('Re-authorize Google access to enable Sheets integration. You\'ll be redirected to Google briefly.')) return;
    const { data } = await api.get('/gmail/auth-url');
    window.location.href = data.url;
  };

  const triggerSync = async () => {
    await api.post('/gmail/sync');
    alert('Sync started — check back in a minute.');
  };

  const retrySkipped = async () => {
    try {
      const { data } = await api.post('/gmail/retry-skipped');
      alert(data.message);
    } catch (err) {
      alert('Retry failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const exportToSheets = async () => {
    setExporting(true);
    try {
      await api.post('/gmail/sheets-export');
      alert('Export complete — Google Sheet has been updated.');
    } catch (err) {
      alert('Export failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setExporting(false);
    }
  };

  const importFromSheets = async () => {
    if (!window.confirm('Import all historical deals from the Google Sheet? Existing companies will be skipped.')) return;
    setImporting(true);
    try {
      const { data } = await api.post('/gmail/sheets-import');
      alert(`Import complete — ${data.imported} added, ${data.skipped} skipped${data.errors ? `, ${data.errors} errors` : ''}.`);
      fetchDeals();
    } catch (err) {
      alert('Import failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
    }
  };

  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s] = deals.filter((d) => d.stage === s).length;
    return acc;
  }, {});

  return (
    <div className="flex min-h-screen flex-col bg-ob-900 dot-grid">
      <Navbar
        gmailStatus={gmailStatus}
        onConnectGmail={connectGmail}
        onSync={triggerSync}
        onRetrySkipped={retrySkipped}
        onImportSheets={importFromSheets}
        importing={importing}
        onExportSheets={exportToSheets}
        exporting={exporting}
        onReauth={reauth}
      />

      <main className="flex-1 px-6 py-6">
        {/* Stats row */}
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-7">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setFilters((f) => ({ ...f, stage: f.stage === s ? '' : s }))}
              className={`rounded-xl border p-4 text-left transition ${
                filters.stage === s
                  ? `bg-ob-800 ${STAGE_ACTIVE[s]}`
                  : `border-ob-600 bg-ob-800 hover:border-ob-400`
              }`}
            >
              <div className={`text-2xl font-bold ${filters.stage === s ? STAGE_ACCENT[s].split(' ')[1] : 'text-ob-50'}`}>
                {stageCounts[s]}
              </div>
              <div className={`mt-0.5 text-xs font-medium ${filters.stage === s ? STAGE_ACCENT[s].split(' ')[1] : 'text-ob-400'}`}>
                {s}
              </div>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by company, founder, description…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="input-dark w-72"
          />
          <select
            value={filters.sector}
            onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
            className="select-dark w-44"
          >
            <option value="">All Sectors</option>
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </select>
          {(filters.stage || filters.sector || filters.search) && (
            <button
              onClick={() => setFilters({ stage: '', sector: '', search: '' })}
              className="text-sm text-ob-400 underline hover:text-ob-100 transition"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto">
            <button
              onClick={openNew}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-ob-900 transition hover:bg-cyan-400 shadow-glow-cyan-sm"
            >
              + Add Deal
            </button>
          </div>
        </div>

        {/* Table */}
        <DealTable
          deals={deals}
          loading={loading}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </main>

      {modalOpen && (
        <DealModal
          deal={editingDeal}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
