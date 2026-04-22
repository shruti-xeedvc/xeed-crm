import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DealTable from '../components/DealTable';
import DealModal from '../components/DealModal';
import api from '../services/api';

const STAGES = ['Screening', 'Due Diligence', 'Invested', 'Passed', 'Lost', 'On Hold'];
const SECTORS = ['Fintech', 'SaaS', 'HealthTech', 'EdTech', 'DeepTech', 'Consumer', 'Logistics', 'CleanTech', 'Other'];

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

  // Handle Gmail OAuth redirect result
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
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar gmailStatus={gmailStatus} onConnectGmail={connectGmail} onSync={triggerSync} onImportSheets={importFromSheets} importing={importing} onExportSheets={exportToSheets} exporting={exporting} onReauth={reauth} />

      <main className="flex-1 px-6 py-6">
        {/* Stats row */}
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setFilters((f) => ({ ...f, stage: f.stage === s ? '' : s }))}
              className={`rounded-xl border p-4 text-left transition ${
                filters.stage === s
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="text-2xl font-bold text-slate-800">{stageCounts[s]}</div>
              <div className="mt-0.5 text-xs font-medium text-slate-500">{s}</div>
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
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <select
            value={filters.sector}
            onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All Sectors</option>
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </select>
          {(filters.stage || filters.sector || filters.search) && (
            <button
              onClick={() => setFilters({ stage: '', sector: '', search: '' })}
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto">
            <button
              onClick={openNew}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
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
