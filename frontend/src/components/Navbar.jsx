import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutList, Kanban, Mail, RefreshCw, LogOut, Download, Upload, ShieldCheck, Users, X, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (form.newPassword !== form.confirm) { setError('New passwords do not match.'); return; }
    setSaving(true);
    try {
      await api.put('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setSuccess('Password updated successfully.');
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Change Password</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={15} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Current Password</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={form.currentPassword}
                onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">New Password</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={form.newPassword}
                onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Confirm New Password</label>
            <input
              type={showNew ? 'text' : 'password'}
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {saving ? 'Saving…' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Navbar({ gmailStatus, onConnectGmail, onSync, onImportSheets, importing, onExportSheets, exporting, onReauth }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center px-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5 pr-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <span className="text-sm font-bold text-white">X</span>
            </div>
            <span className="font-semibold text-slate-800">Xeed VC</span>
          </div>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            <Link
              to="/dashboard"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                pathname === '/dashboard' ? 'bg-brand-50 text-brand-600' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <LayoutList size={15} />
              Table
            </Link>
            <Link
              to="/pipeline"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                pathname === '/pipeline' ? 'bg-brand-50 text-brand-600' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Kanban size={15} />
              Pipeline
            </Link>
            {user?.role === 'admin' && (
              <Link
                to="/team"
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  pathname === '/team' ? 'bg-brand-50 text-brand-600' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Users size={15} />
                Team
              </Link>
            )}
          </nav>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-3">
            {/* Gmail sync */}
            {gmailStatus?.connection ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-green-400" />
                  {gmailStatus.connection.gmail_email}
                </span>
                <button onClick={onSync} title="Sync emails now" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
                  <RefreshCw size={14} />
                </button>
                {onImportSheets && (
                  <button
                    onClick={onImportSheets}
                    disabled={importing}
                    title="Import historical deals from Google Sheet"
                    className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Download size={12} />
                    {importing ? 'Importing…' : 'Import Sheet'}
                  </button>
                )}
                {onExportSheets && (
                  <button
                    onClick={onExportSheets}
                    disabled={exporting}
                    title="Export all CRM deals to Google Sheet"
                    className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Upload size={12} />
                    {exporting ? 'Exporting…' : 'Export Sheet'}
                  </button>
                )}
                <button onClick={onReauth} title="Re-authorize Google permissions" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                  <ShieldCheck size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={onConnectGmail}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Mail size={13} />
                Connect Gmail
              </button>
            )}

            {/* User */}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <button
                onClick={() => setShowPasswordModal(true)}
                title="Change password"
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-100 transition"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                  {user?.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-sm text-slate-700">{user?.name}</span>
              </button>
              <button onClick={logout} title="Sign out" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </>
  );
}
