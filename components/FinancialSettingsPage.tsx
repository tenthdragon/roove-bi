// @ts-nocheck
// components/FinancialSettingsPage.tsx
'use client';

import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BankAccount {
  id: string;
  bank: string;
  account_no: string;
  account_name: string;
  business_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type FormMode = 'add' | 'edit';

const BANK_OPTIONS = ['BCA', 'BRI', 'Mandiri', 'BSI', 'BNI', 'CIMB Niaga', 'Danamon', 'Permata', 'BTN', 'Lainnya'];

const BANK_COLORS: Record<string, string> = {
  BCA:        '#005BAA',
  BRI:        '#00529B',
  Mandiri:    '#003087',
  BSI:        '#007A3D',
  BNI:        '#f96d00',
  'CIMB Niaga': '#CC0000',
  Danamon:    '#E2001A',
  Permata:    '#003D7C',
  BTN:        '#009245',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function BankBadge({ bank }: { bank: string }) {
  const color = BANK_COLORS[bank] || '#64748b';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      background: color + '22', color,
    }}>
      {bank}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: active ? 'var(--badge-green-bg)' : 'var(--bg-deep)',
      color: active ? 'var(--green)' : 'var(--dim)',
    }}>
      {active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}

// ── Form Modal ────────────────────────────────────────────────────────────────

const EMPTY_FORM = { bank: 'BCA', account_no: '', account_name: '', business_name: '', description: '', is_active: true };

function AccountForm({
  mode, initial, onSave, onCancel,
}: {
  mode: FormMode;
  initial: typeof EMPTY_FORM & { id?: string };
  onSave: (data: any) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [form, setForm]     = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(key: string, val: any) { setForm(f => ({ ...f, [key]: val })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.account_no.trim() || !form.account_name.trim() || !form.business_name.trim()) {
      setError('No. Rekening, Nama Rekening, dan Nama Bisnis wajib diisi.'); return;
    }
    setSaving(true); setError('');
    const err = await onSave(form);
    if (err) { setError(err); setSaving(false); }
  }

  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg-deep)',
    color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' as const,
    outline: 'none',
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--dim)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <form
        onSubmit={submit}
        style={{
          background: 'var(--card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480,
          border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          {mode === 'add' ? '+ Tambah Rekening' : '✎ Edit Rekening'}
        </div>

        {/* Bank */}
        <div>
          <label style={labelStyle}>Bank</label>
          <select value={form.bank} onChange={e => set('bank', e.target.value)} style={inputStyle}>
            {BANK_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* No. Rekening */}
        <div>
          <label style={labelStyle}>No. Rekening <span style={{ color: 'var(--red)' }}>*</span></label>
          <input
            value={form.account_no} onChange={e => set('account_no', e.target.value)}
            placeholder="Contoh: 4377662333" style={inputStyle}
            inputMode="numeric"
          />
        </div>

        {/* Nama Rekening */}
        <div>
          <label style={labelStyle}>Nama Pemilik Rekening <span style={{ color: 'var(--red)' }}>*</span></label>
          <input
            value={form.account_name} onChange={e => set('account_name', e.target.value)}
            placeholder="Contoh: ROOVE TIJARA INTERNASIONAL" style={inputStyle}
          />
        </div>

        {/* Bisnis */}
        <div>
          <label style={labelStyle}>Untuk Bisnis <span style={{ color: 'var(--red)' }}>*</span></label>
          <input
            value={form.business_name} onChange={e => set('business_name', e.target.value)}
            placeholder="Contoh: RTI, Roove Lautan Barat" style={inputStyle}
          />
        </div>

        {/* Keterangan */}
        <div>
          <label style={labelStyle}>Keterangan <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(opsional)</span></label>
          <input
            value={form.description || ''} onChange={e => set('description', e.target.value)}
            placeholder="Contoh: Rekening utama penerimaan payment" style={inputStyle}
          />
        </div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ ...labelStyle, margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox" checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', textTransform: 'none', letterSpacing: 0 }}>Rekening Aktif</span>
          </label>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)', background: 'rgba(239,68,68,0.08)', padding: '8px 12px', borderRadius: 6 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 13, cursor: 'pointer' }}>
            Batal
          </button>
          <button type="submit" disabled={saving} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FinancialSettingsPage() {
  const [accounts, setAccounts]   = useState<BankAccount[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [modal, setModal]         = useState<{ mode: FormMode; data: any } | null>(null);
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bank-accounts');
      const d   = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Gagal memuat rekening');
      setAccounts(d.accounts);
    } catch (e: any) {
      setError(e.message || 'Gagal memuat rekening');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(formData: any): Promise<string | null> {
    const isEdit = modal?.mode === 'edit';
    const body   = isEdit ? { id: modal.data.id, ...formData } : formData;
    const res    = await fetch('/api/bank-accounts', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (d.error) return d.error;
    setError('');
    setModal(null);
    load();
    return null;
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Hapus rekening "${name}"? Aksi ini tidak bisa dibatalkan.`)) return;
    setDeleting(id);
    setError('');
    const res = await fetch('/api/bank-accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const d = await res.json().catch(() => ({}));
    setDeleting(null);
    if (!res.ok || d.error) {
      setError(d.error || 'Gagal menghapus rekening');
      return;
    }
    load();
  }

  async function toggleActive(acc: BankAccount) {
    setError('');
    const res = await fetch('/api/bank-accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: acc.id, is_active: !acc.is_active }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) {
      setError(d.error || 'Gagal memperbarui status rekening');
      return;
    }
    load();
  }

  const filtered = accounts.filter(a => {
    if (filterActive === 'active')   return a.is_active;
    if (filterActive === 'inactive') return !a.is_active;
    return true;
  });

  // Group by business_name
  const byBusiness: Record<string, BankAccount[]> = {};
  for (const a of filtered) {
    if (!byBusiness[a.business_name]) byBusiness[a.business_name] = [];
    byBusiness[a.business_name].push(a);
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>⚙️ Financial Settings</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
            Daftar rekening bank yang digunakan per bisnis
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: 'add', data: { ...EMPTY_FORM } })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + Tambah Rekening
        </button>
      </div>

      {/* ── Filter bar ── */}
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilterActive(f)}
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, cursor: 'pointer',
                background: filterActive === f ? 'var(--accent)' : 'var(--bg-deep)',
                color: filterActive === f ? '#fff' : 'var(--text-secondary)',
                fontWeight: filterActive === f ? 700 : 400,
              }}
            >
              {f === 'all' ? `Semua (${accounts.length})` : f === 'active' ? `Aktif (${accounts.filter(a => a.is_active).length})` : `Nonaktif (${accounts.filter(a => !a.is_active).length})`}
            </button>
          ))}
        </div>
      )}

      {/* ── Loading / Error ── */}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 12 }}>Memuat…</div>}
      {!loading && error && (
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 8, padding: 16, color: '#fca5a5', fontSize: 13 }}>{error}</div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && accounts.length === 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Belum Ada Rekening Terdaftar</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 20 }}>Tambahkan rekening bank yang digunakan untuk masing-masing bisnis.</div>
          <button
            onClick={() => setModal({ mode: 'add', data: { ...EMPTY_FORM } })}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}
          >
            + Tambah Rekening
          </button>
        </div>
      )}

      {/* ── Account list grouped by business ── */}
      {!loading && filtered.length > 0 && Object.entries(byBusiness).map(([biz, accs]) => (
        <div key={biz} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Business header */}
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-deep)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🏢</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{biz}</span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>{accs.length} rekening</span>
          </div>

          {/* Account rows */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Bank', 'No. Rekening', 'Nama Pemilik', 'Keterangan', 'Status', 'Aksi'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accs.map(acc => (
                  <tr
                    key={acc.id}
                    style={{ borderBottom: '1px solid rgba(55,65,81,0.3)', opacity: acc.is_active ? 1 : 0.55 }}
                  >
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <BankBadge bank={acc.bank} />
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: 'var(--text)', whiteSpace: 'nowrap', fontSize: 13 }}>
                      {acc.account_no}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {acc.account_name}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--dim)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {acc.description || <span style={{ color: 'var(--dim)', opacity: 0.4 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => toggleActive(acc)}
                        title={acc.is_active ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        <StatusBadge active={acc.is_active} />
                      </button>
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setModal({ mode: 'edit', data: { id: acc.id, bank: acc.bank, account_no: acc.account_no, account_name: acc.account_name, business_name: acc.business_name, description: acc.description || '', is_active: acc.is_active } })}
                          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(acc.id, `${acc.bank} ${acc.account_no}`)}
                          disabled={deleting === acc.id}
                          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 12, cursor: 'pointer', opacity: deleting === acc.id ? 0.5 : 1 }}
                        >
                          {deleting === acc.id ? '…' : 'Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* ── Modal Form ── */}
      {modal && (
        <AccountForm
          mode={modal.mode}
          initial={modal.data}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
