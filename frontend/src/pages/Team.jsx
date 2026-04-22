import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Trash2, Plus, Eye, EyeOff } from 'lucide-react';

const ROLES = [
  { value: 'analyst', label: 'Investment Team' },
  { value: 'admin', label: 'Admin' },
];

export default function Team() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/auth/users');
      setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    api.get('/gmail/status').then(({ data }) => setGmailStatus(data)).catch(() => {});
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name || !form.email || !form.password) {
      setError('Name, email and password are required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/register', form);
      setSuccess(`Account created for ${form.name}.`);
      setForm({ name: '', email: '', password: '', role: 'analyst' });
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create account.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (id === user.id) { setError("You can't delete your own account."); return; }
    if (!window.confirm(`Remove ${name}'s account? They will no longer be able to log in.`)) return;
    try {
      await api.delete(`/auth/users/${id}`);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove user.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-ob-900 dot-grid">
      <Navbar gmailStatus={gmailStatus} />

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold text-ob-50 tracking-tight">Team Members</h1>

        {/* Existing users */}
        <div className="mb-8 overflow-hidden rounded-xl border border-ob-600 bg-ob-800">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-ob-600 border-t-cyan-400" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ob-600 bg-ob-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ob-400">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ob-400">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ob-400">Role</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ob-700">
                {users.map((u) => (
                  <tr key={u.id} className="group hover:bg-ob-700/40 transition">
                    <td className="px-4 py-3 font-medium text-ob-50">
                      {u.name}
                      {u.id === user.id && <span className="ml-2 text-xs text-ob-500">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-ob-400">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        u.role === 'admin'
                          ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                          : 'bg-ob-700 text-ob-300 border border-ob-600'
                      }`}>
                        {u.role === 'admin' ? 'Admin' : 'Investment Team'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== user.id && (
                        <button
                          onClick={() => handleDelete(u.id, u.name)}
                          className="rounded p-1 text-ob-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add new user */}
        <div className="rounded-xl border border-ob-600 bg-ob-800 p-6">
          <h2 className="mb-4 text-sm font-semibold text-ob-300 uppercase tracking-wider">Add Team Member</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Full Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Anirudh Sharma"
                  className="input-dark"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="anirudh@xeedvc.com"
                  className="input-dark"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Temporary Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Min 8 characters"
                    className="input-dark pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-ob-400 hover:text-ob-100 transition"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="select-dark"
                >
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
            {success && <p className="text-xs text-emerald-400">{success}</p>}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-ob-900 hover:bg-cyan-400 disabled:opacity-60 transition shadow-glow-cyan-sm"
              >
                <Plus size={14} />
                {saving ? 'Creating…' : 'Add Member'}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-4 text-xs text-ob-500">
          Share the temporary password with your team member — they can change it after logging in via their profile.
        </p>
      </main>
    </div>
  );
}
