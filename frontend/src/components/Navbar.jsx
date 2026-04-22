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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-ob-600 bg-ob-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ob-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-ob-50">Change Password</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ob-400 hover:bg-ob-700 hover:text-ob-50 transition">
            <X size={15} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Current Password</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={form.currentPassword}
                onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
                className="input-dark pr-9"
              />
              <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute right-2.5 top-2.5 text-ob-400 hover:text-ob-100 transition">
                {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">New Password</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={form.newPassword}
                onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                className="input-dark pr-9"
              />
              <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-2.5 top-2.5 text-ob-400 hover:text-ob-100 transition">
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Confirm New Password</label>
            <input
              type={showNew ? 'text' : 'password'}
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
              className="input-dark"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && <p className="text-xs text-emerald-400">{success}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-ob-600 px-4 py-2 text-sm text-ob-400 hover:bg-ob-700 hover:text-ob-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-ob-900 hover:bg-cyan-400 disabled:opacity-60 transition">
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

  const navLink = (to, icon, label) => (
    <Link
      to={to}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        pathname === to
          ? 'bg-cyan-500/10 text-cyan-400'
          : 'text-ob-400 hover:bg-ob-700 hover:text-ob-50'
      }`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <>
      <header className="border-b border-ob-600 bg-ob-800">
        <div className="flex h-14 items-center px-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5 pr-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-ob-600 bg-ob-900 shadow-glow-cyan-sm">
              <span className="text-sm font-bold text-cyan-400">X</span>
            </div>
            <span className="font-semibold text-ob-50 tracking-tight">Xeed VC</span>
          </div>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navLink('/dashboard', <LayoutList size={15} />, 'Table')}
            {navLink('/pipeline', <Kanban size={15} />, 'Pipeline')}
            {user?.role === 'admin' && navLink('/team', <Users size={15} />, 'Team')}
          </nav>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            {/* Gmail sync */}
            {gmailStatus?.connection ? (
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 text-xs text-ob-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                  {gmailStatus.connection.gmail_email}
                </span>
                <button onClick={onSync} title="Sync emails now" className="rounded-lg p-1.5 text-ob-400 transition hover:bg-ob-700 hover:text-ob-50">
                  <RefreshCw size={14} />
                </button>
                {onImportSheets && (
                  <button
                    onClick={onImportSheets}
                    disabled={importing}
                    title="Import historical deals from Google Sheet"
                    className="flex items-center gap-1 rounded-lg border border-ob-600 px-2.5 py-1.5 text-xs font-medium text-ob-400 transition hover:bg-ob-700 hover:text-ob-50 disabled:opacity-50"
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
                    className="flex items-center gap-1 rounded-lg border border-ob-600 px-2.5 py-1.5 text-xs font-medium text-ob-400 transition hover:bg-ob-700 hover:text-ob-50 disabled:opacity-50"
                  >
                    <Upload size={12} />
                    {exporting ? 'Exporting…' : 'Export Sheet'}
                  </button>
                )}
                <button onClick={onReauth} title="Re-authorize Google permissions" className="rounded-lg p-1.5 text-ob-500 transition hover:bg-ob-700 hover:text-ob-300">
                  <ShieldCheck size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={onConnectGmail}
                className="flex items-center gap-1.5 rounded-lg border border-ob-600 px-3 py-1.5 text-xs font-medium text-ob-400 transition hover:border-cyan-500/50 hover:text-cyan-400"
              >
                <Mail size={13} />
                Connect Gmail
              </button>
            )}

            {/* User */}
            <div className="flex items-center gap-1.5 border-l border-ob-600 pl-3">
              <button
                onClick={() => setShowPasswordModal(true)}
                title="Change password"
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-ob-700 transition"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 border border-cyan-500/30 text-xs font-semibold text-cyan-400">
                  {user?.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-sm text-ob-300">{user?.name}</span>
              </button>
              <button onClick={logout} title="Sign out" className="rounded-lg p-1 text-ob-500 transition hover:bg-ob-700 hover:text-ob-300">
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
