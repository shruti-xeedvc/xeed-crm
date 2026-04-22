import { useState, useEffect } from 'react';
import { X, Plus, Minus } from 'lucide-react';

const STAGES = ['Screening', 'Due Diligence', 'Invested', 'Passed', 'Lost', 'On Hold', 'Tracking'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const SECTORS = ['Fintech', 'SaaS', 'HealthTech', 'EdTech', 'DeepTech', 'Consumer', 'Logistics', 'CleanTech', 'Other'];

const POC_OPTIONS = ['', 'Anirudh', 'Shruti', 'Sailesh', 'Aditya'];

const EMPTY = {
  company_name: '', brand: '', founders: [''],
  sector: '', location: '', funding_ask: '',
  stage: 'Screening', priority: 'Medium',
  ai_score: '', notes: '', date_added: new Date().toISOString().split('T')[0],
  description: '', founder_background: '', poc: '', deck_link: '',
};

const Field = ({ label, error, children }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold text-ob-400 uppercase tracking-wider">{label}</label>
    {children}
    {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
  </div>
);

const Input = ({ field, form, errors, set, ...props }) => (
  <input
    value={form[field]}
    onChange={(e) => set(field, e.target.value)}
    className={`w-full rounded-lg border px-3 py-2 text-sm text-ob-50 bg-ob-900 outline-none transition placeholder:text-ob-500
      focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 ${
      errors[field] ? 'border-red-500/60' : 'border-ob-600'
    }`}
    {...props}
  />
);

export default function DealModal({ deal, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (deal) {
      setForm({
        ...EMPTY,
        ...deal,
        founders: deal.founders?.length ? deal.founders : [''],
        ai_score: deal.ai_score ?? '',
        date_added: deal.date_added
          ? new Date(deal.date_added).toISOString().split('T')[0]
          : EMPTY.date_added,
      });
    }
  }, [deal]);

  const set = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: '' }));
  };

  const setFounder = (i, value) => {
    const next = [...form.founders];
    next[i] = value;
    setForm((f) => ({ ...f, founders: next }));
  };

  const addFounder = () => setForm((f) => ({ ...f, founders: [...f.founders, ''] }));
  const removeFounder = (i) =>
    setForm((f) => ({ ...f, founders: f.founders.filter((_, idx) => idx !== i) }));

  const validate = () => {
    const errs = {};
    if (!form.company_name.trim()) errs.company_name = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave({
        ...form,
        founders: form.founders.filter(Boolean),
        ai_score: form.ai_score !== '' ? Number(form.ai_score) : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-ob-600 bg-ob-800 shadow-2xl scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ob-600 px-6 py-4">
          <h2 className="text-base font-semibold text-ob-50">
            {deal ? 'Edit Deal' : 'Add New Deal'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ob-400 hover:bg-ob-700 hover:text-ob-50 transition">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Row 1 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Name *" error={errors.company_name}>
              <Input field="company_name" placeholder="Acme Inc." form={form} errors={errors} set={set} />
            </Field>
            <Field label="Brand / Product">
              <Input field="brand" placeholder="AcmeApp" form={form} errors={errors} set={set} />
            </Field>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sector">
              <select
                value={form.sector}
                onChange={(e) => set('sector', e.target.value)}
                className="select-dark"
              >
                <option value="">Select sector</option>
                {SECTORS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <Input field="location" placeholder="Mumbai, India" form={form} errors={errors} set={set} />
            </Field>
          </div>

          {/* Row 3 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Funding Ask">
              <Input field="funding_ask" placeholder="$2M" form={form} errors={errors} set={set} />
            </Field>
            <Field label="Stage">
              <select
                value={form.stage}
                onChange={(e) => set('stage', e.target.value)}
                className="select-dark"
              >
                {STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          {/* Date Added */}
          <Field label="Date Added">
            <Input field="date_added" type="date" form={form} errors={errors} set={set} />
          </Field>

          {/* Founders */}
          <Field label="Founders">
            <div className="space-y-2">
              {form.founders.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={f}
                    onChange={(e) => setFounder(i, e.target.value)}
                    placeholder={`Founder ${i + 1} name`}
                    className="flex-1 rounded-lg border border-ob-600 bg-ob-900 px-3 py-2 text-sm text-ob-50 outline-none transition placeholder:text-ob-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  />
                  {form.founders.length > 1 && (
                    <button type="button" onClick={() => removeFounder(i)} className="rounded-lg p-2 text-ob-500 hover:bg-red-500/10 hover:text-red-400 transition">
                      <Minus size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addFounder}
                className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition"
              >
                <Plus size={12} /> Add founder
              </button>
            </div>
          </Field>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="What the company does in 1–2 sentences…"
              className="w-full rounded-lg border border-ob-600 bg-ob-900 px-3 py-2 text-sm text-ob-50 outline-none transition placeholder:text-ob-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 resize-none"
            />
          </Field>

          {/* Founder Background + POC */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Founder Background">
              <Input field="founder_background" placeholder="linkedin.com/in/… or 1-line bio" form={form} errors={errors} set={set} />
            </Field>
            <Field label="POC (Xeed Team)">
              <select
                value={form.poc}
                onChange={(e) => set('poc', e.target.value)}
                className="select-dark"
              >
                {POC_OPTIONS.map((p) => <option key={p} value={p}>{p || 'Select…'}</option>)}
              </select>
            </Field>
          </div>

          {/* Deck Link */}
          <Field label="Pitch Deck Link">
            <Input field="deck_link" placeholder="https://drive.google.com/…" type="url" form={form} errors={errors} set={set} />
          </Field>

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Key observations, highlights, concerns…"
              className="w-full rounded-lg border border-ob-600 bg-ob-900 px-3 py-2 text-sm text-ob-50 outline-none transition placeholder:text-ob-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 resize-none"
            />
          </Field>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-ob-600 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ob-600 px-4 py-2 text-sm font-medium text-ob-400 hover:bg-ob-700 hover:text-ob-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-cyan-500 px-5 py-2 text-sm font-semibold text-ob-900 hover:bg-cyan-400 disabled:opacity-60 transition shadow-glow-cyan-sm"
            >
              {saving ? 'Saving…' : deal ? 'Save Changes' : 'Add Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
