import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import KanbanBoard from '../components/KanbanBoard';
import DealModal from '../components/DealModal';
import api from '../services/api';

export default function Pipeline() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState(null);
  const [gmailStatus, setGmailStatus] = useState(null);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/deals');
      setDeals(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);
  useEffect(() => {
    api.get('/gmail/status').then(({ data }) => setGmailStatus(data)).catch(() => {});
  }, []);

  const handleStageChange = async (dealId, newStage) => {
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d))
    );
    await api.put(`/deals/${dealId}`, { stage: newStage });
  };

  const openEdit = (deal) => { setEditingDeal(deal); setModalOpen(true); };
  const openNew = () => { setEditingDeal(null); setModalOpen(true); };

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

  const triggerSync = async () => {
    await api.post('/gmail/sync');
    alert('Sync started — check back in a minute.');
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar gmailStatus={gmailStatus} onConnectGmail={connectGmail} onSync={triggerSync} />

      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Pipeline</h2>
          <button
            onClick={openNew}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + Add Deal
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : (
          <KanbanBoard
            deals={deals}
            onStageChange={handleStageChange}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        )}
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
