import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ob-900 dot-grid">
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-ob-800 border border-ob-600 shadow-glow-cyan">
            <span className="text-2xl font-bold text-cyan-400">X</span>
          </div>
          <h1 className="text-2xl font-bold text-ob-50 tracking-tight">Xeed VC</h1>
          <p className="mt-1.5 text-sm text-ob-400">Deal Flow CRM</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-ob-600 bg-ob-800 p-8 shadow-glow-card">
          <h2 className="mb-6 text-sm font-semibold text-ob-300 uppercase tracking-wider">Sign in to your account</h2>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@xeedvc.com"
                className="input-dark"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ob-400 uppercase tracking-wider">Password</label>
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="input-dark"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-ob-900 transition hover:bg-cyan-400 shadow-glow-cyan-sm disabled:opacity-50 disabled:shadow-none mt-2"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
